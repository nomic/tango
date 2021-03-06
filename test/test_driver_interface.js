'use strict';
/*global suite: false, test: false, setup: false*/
/*jshint expr: true*/
var chai = require('chai'),
  expect = chai.expect,
  Promise = require('bluebird'),
  tango = require('../index'),
  request = require('request'),
  ExpectationError = tango.ExpectationError,
  step = tango.step, as = tango.as, req = tango.req,
  sequentially = tango.sequentially, concurrently = tango.concurrently,
  eventually = tango.eventually, wait = tango.wait;


suite('Actors', function() {

  test('as', function() {
    return sequentially(
      as('mia'),
      function(ctx) {
        expect(ctx.currentActor()).to.eql('mia');
        expect(ctx.jarForCurrentActor(request.jar)).to.be.a('Object');
      }
    )(new tango.Context());
  });

  test('as, nested', function() {
    return as('mia',
      as('ella',
        function(ctx) {
          expect(ctx.currentActor()).to.eql('ella');
          return ctx;
        }
      ),
      function(ctx) {
        expect(ctx.currentActor()).to.eql('mia');
        return ctx;
      }
    )(new tango.Context())
    .then(function(ctx) {
      expect(ctx.currentActor()).to.equal(null);
    });
  });

});

suite('Requests', function() {
  req = req.handler(mockRequest);

  function mockRequest(opts) {
    var urlParts = opts.relativeUrl.split('/');
    var body = opts.body;
    return Promise.try(function() {
      if ('status' === urlParts[1]) {
        var statusCode = urlParts[2];
        return {
          statusCode: parseInt(statusCode, 10)
        };
      }
      if ('reflect' === urlParts[1]) {
        return {
          statusCode: 200,
          body: body
        };
      }
      if ('reflectUrl' === urlParts[1]) {
        return {
          statusCode: 200,
          body: {url: (opts.rootUrl || "") + opts.relativeUrl}
        };
      }
      if ('reflectHeaders' === urlParts[1]) {
        return {
          statusCode: 200,
          body: opts.headers
        };
      }
    });
  }

  test('passing expectation', function() {
    return req
      .GET('/status/204')
      .expect(204)
      (new tango.Context());
  });

  test('failing expectation', function() {
    return req
      .GET('/status/204')
      .expect(200)
      (new tango.Context())
      .catch(ExpectationError, function(err) {
        return err;
      });
  });

  test('failing first expectation', function() {
    return req
      .GET('/status/204')
      .expect(200)
      .expect(204)
      (new tango.Context())
      .catch(ExpectationError, function(err) {
        return err;
      });
  });

  test('expectation on body', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect({foo: 'bar'})
      (new tango.Context());
  });

  test('expectation on status and body', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect(200, {foo: 'bar'})
      (new tango.Context());
  });

  test('expectation on fn', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect(function(body, res) {
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.eql(body).to.eql({foo: 'bar'});
      })
      (new tango.Context());
  });

  test('expectation on status and fn', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect(200, function(body, res) {
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.eql(body).to.eql({foo: 'bar'});
      })
      (new tango.Context());
  });

  test('stash', function() {
    return sequentially(
      req
        .POST('/reflect', {foo: 'bar'})
        .stash('result'),

      concurrently(
        req
          .POST('/reflect', {nested: ':result'})
          .expect({ nested: { foo: 'bar'} }),
        req
          .POST('/reflect', {nested: ':result'})
          .expect({nested: ':result'}),
        req
          .POST('/reflectUrl/:result.foo')
          .expect({ url: '/reflectUrl/bar' })
      )

    )(new tango.Context());
  });

  test('stash with scraping function', function() {
    return sequentially(
      req
        .POST('/reflect', {foo: 'bar'})
        .stash('result', function(body, res) {
          expect(res.statusCode).to.equal(200);
          expect(res.body).to.eql(body);
          return body.foo;
        }),
      req
        .POST('/reflect', {nested: ':result'})
        .expect({ nested: 'bar' })
    )(new tango.Context());
  });

  test('headers context function', function() {
    return sequentially(
      req
        .POST('/reflect', {foo: 'bar'})
        .stash('result'),
      req
        .POST('/reflectHeaders', {nested: ':result'})
        .headers(function(ctx) {
          return {'x-header': ctx.stash.get('result').foo};
        })
        .expect({ 'x-header': 'bar' })
    )(new tango.Context());
  });

});

suite('Control Flow', function() {
  test('sequentially', function() {

    return sequentially(
      function(ctx) {ctx.counter = 1; return ctx;},
      function(ctx) {ctx.counter++; return ctx;},
      function(ctx) {expect(ctx.counter).to.equal(2); }
    )(new tango.Context());
  });

  test('sequentially with array', function() {

    return sequentially([
      function(ctx) {ctx.counter = 1; return ctx;},
      function(ctx) {ctx.counter++; return ctx;},
      function(ctx) {expect(ctx.counter).to.equal(2); }
    ])(new tango.Context());
  });

  test('steps', function() {

    return sequentially(
      step('Do something',
          function(ctx) {ctx.counter = 1; return ctx;}
      ),
      step('Then do this',
        sequentially(
          function(ctx) {ctx.counter++; return ctx;},
          function(ctx) {expect(ctx.counter).to.equal(2); }))
    )(new tango.Context());
  });

  test('concurrently', function() {
    var val = null;
    return concurrently(
      function(ctx) {
        return Promise.delay(20)
        .then(function() { val = 'delayed'; return ctx; });
      },
      function(ctx) {val = 'immediate'; return ctx;},
      function(ctx) {
        return Promise.delay(10)
        .then(function() {
          expect(val).to.equal('immediate');
          return ctx;
        });
      }
    )(new tango.Context());
  });

  test('concurrently with array', function() {

    return concurrently([
      function(ctx) { return ctx; },
      function(ctx) { return ctx; }
    ])(new tango.Context());
  });

  test('eventually', function() {

    var tries = 0;
    return eventually(
      function(ctx) {
        if (tries++ < 3) {
          throw new Error();
        }
        return ctx;
      }
    )(new tango.Context());
  });

  test('wait', function() {

    var tries = 0;
    var start = Date.now();
    return sequentially(
      wait(10),
      function() {
        expect(Date.now() - start).is.gte(10);
      }
    )(new tango.Context());
  });

});


suite("Run", function() {

  test('Without context', function() {
    return tango(function(ctx) {
      expect(ctx.currentActor).to.exist;
    });
  });

});
