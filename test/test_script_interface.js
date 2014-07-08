'use strict';
/*global suite: false, test: false, setup: false*/
var chai = require('chai'),
  expect = chai.expect,
  assert = chai.assert,
  Promise = require('bluebird'),
  driver = require('../driver2'),
  ContextError = driver.ContextError,
  ExpectationError = driver.ExpectationError,
  low = driver.flow, step = driver.step, as = driver.as, req = driver.req,
  sequence = driver.sequence, eventually = driver.eventually, introduce = driver.introduce;


suite('Actors', function() {
  test('introduce', function() {
    var ctx = new driver.Context();
    expect(function() {
      ctx.jarFor('mia');
    }).to.throw(driver.ContextError);

    ctx = introduce('mia')(new driver.Context());
    assertIsACookieJar( ctx.jarFor('mia') );
  });

  test('multiple introductions', function() {
    return sequence(
      introduce('mia'),
      introduce('ella')
    )(new driver.Context())
    .then(function(ctx) {
      assertIsACookieJar( ctx.jarFor('mia') );
      assertIsACookieJar( ctx.jarFor('ella') );
      expect(ctx.currentActor()).to.eql('ella');
    });
  });

  test('as', function() {
    return sequence(
      introduce('mia'),
      introduce('ella'),
      as('mia')
    )(new driver.Context())
    .then(function(ctx) {
      expect(ctx.currentActor()).to.eql('mia');
    });
  });
});

suite('Requests', function() {
  req = req.handler(mockRequest);

  function mockRequest(opts) {
    var uriParts = opts.relativeUri.split('/');
    var body = opts.body;
    return Promise.try(function() {
      if ('status' === uriParts[1]) {
        var statusCode = uriParts[2];
        return {
          statusCode: parseInt(statusCode, 10)
        };
      }
      if ('reflect' === uriParts[1]) {
        return {
          statusCode: 200,
          body: body
        };
      }
    });
  }

  test('passing expectation', function() {
    return req
      .GET('/status/204')
      .expect(204)
      (new driver.Context())
      .then(function(ctx) {
        expect(ctx.expectationsPassed).to.eql(1);
      });
  });

  test('failing expectation', function() {
    return req
      .GET('/status/204')
      .expect(200)
      (new driver.Context())
      .catch(ExpectationError, function(err) {
        return err;
      });
      // .then( function(caughtError) {
      //   expect(caughtError).to.be.instanceOf(ExpectationError);
      // });
  });

  test('expectation on body', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect({foo: 'bar'})
      (new driver.Context())
      .then(function(ctx) {
        expect(ctx.expectationsPassed).to.eql(1);
      });
  });

  test('expectation on status and body', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect(200, {foo: 'bar'})
      (new driver.Context())
      .then(function(ctx) {
        expect(ctx.expectationsPassed).to.eql(1);
      });
  });

  test('expectation on fn', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect(function(res) {
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.eql({foo: 'bar'});
      })
      (new driver.Context())
      .then(function(ctx) {
        expect(ctx.expectationsPassed).to.eql(1);
      });
  });

  test('expectation on status and fn', function() {
    return req
      .POST('/reflect', {foo: 'bar'})
      .expect(200, function(res) {
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.eql({foo: 'bar'});
      })
      (new driver.Context())
      .then(function(ctx) {
        expect(ctx.expectationsPassed).to.eql(1);
      });
  });

});

suite('Control Flow', function() {
  test('sequence', function() {

    return sequence(
      function(ctx) {ctx.counter = 1; return ctx;},
      function(ctx) {ctx.counter++; return ctx;}
    )(new driver.Context())
    .then(function(ctx) {
      expect(ctx.counter).to.equal(2);
    });
  });

});


function assertIsACookieJar(obj) {
  expect(obj.getCookieString).is.a('function');
  expect(obj.setCookie).is.a('function');
}