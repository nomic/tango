'use strict';
var expector = require('./expector'),
    _ = require('lodash'),
    Promise = require('bluebird'),
    zlib = Promise.promisifyAll(require('zlib')),
    request = require('request'),
    prequest = Promise.promisify(request),
    util = require('util'),
    assert = require('assert'),
    Cookie = require('tough-cookie').Cookie;

var reqAPI = {

  rootUrl: function(url) {
    return this.clone({reqOpts: {rootUrl: url}});
  },

  handler: function(fn) {
    return this.clone({handler: fn});
  },

  headers: function(headers) {
    if (_.isFunction(headers)) {
      return this.clone({reqOpts: {headerFns: [headers]}});
    }
    return this.clone({reqOpts: {headers: headers}});
  },

  expectStrict: function req$expectStrict() {
    var sourceMap = stackAbove(req$expectStrict);
    return expectShim(this, _.toArray(arguments), sourceMap, {strict: true});
  },

  expect: function req$expect() {
    var sourceMap = stackAbove(req$expect);
    return expectShim(this, _.toArray(arguments), sourceMap, {strict: false});
  },

  defaultExpect: function(fn) {
    return this.clone({defaultExpectFn: fn});
  },

  stash: function(key, scraper) {
    scraper = scraper || _.identity;
    var stasher = function(ctx, res) {
      scraper = _.partialRight(scraper, ctx);
      ctx.stash.set(key, scraper(res.body, res));
    };
    return this.clone({stashers: [stasher]});
  },

  log: function() {
    return this.clone({log: true});
  },

  formData: function() {
    return this.clone({reqOpts: {form: [_.toArray(arguments)]}});
  },

  clone: function(clauses) {
    clauses = clauses || {};
    return makeReq(_.merge(
      {},
      this._clauses,
      clauses,
      function(a, b) {
        return _.isArray(a) ? a.concat(b) : undefined;
      }
    ));
  }
};

_.each(['POST', 'PUT', 'PATCH'], function(method) {
  addHttpMethod(method, true);
});

_.each(['DELETE', 'GET', 'HEAD'], function(method) {
  addHttpMethod(method);
});

var clauses = {
  handler: defaultHandler,
  reqOpts: {
    rootUrl: "",
  },
  expectations: [],
  stashers: [],
  log: false
};

module.exports = {
  req: makeReq(clauses),
  ExpectationError: expector.ExpectationError
};

function expectShim(reqObj, args, sourceMap, opts) {
  var expected = {};
  expected.statusCode = _.isNumber(args[0]) ? args.shift() : undefined;
  expected.body = args[0];

  assert(args[1] === undefined, 'Extra parameter passed to expect');

  assert( existy(expected.statusCode) || existy(expected.body),
          "Invalid expectation: " + util.inspect(expected));
  var expectation = function(ctx, actual) {
    expected = ctx.stash.substitute(expected);
    if (_.isFunction(expected.body)) {
      expected.body = _.partialRight(expected.body, ctx);
    }
    return expector.expect(actual, expected, sourceMap, opts);
  };
  return reqObj.clone({expectations: [expectation]});
}

function addHttpMethod(method, hasBody) {
  reqAPI[method] = function reqMethod(relativeUrl, body) {
    var reqOpts = _.extend(
      { method: method, relativeUrl: relativeUrl},
      hasBody ? {body: body} : {}
    );
    var defaultExpectation;
    if (this._clauses.defaultExpectFn) {
      var fn = this._clauses.defaultExpectFn;
      var sourceMap = stackAbove(reqMethod);
      defaultExpectation = function(ctx, actual) {
        return expector.expect(actual, {body: fn}, sourceMap);
      };
    }
    return this.clone({
      reqOpts: reqOpts,
      defaultExpectation: defaultExpectation
    });
  };
}

function stackAbove(fn) {
  var error = new Error();
  Error.captureStackTrace(error, fn);
  return error.stack;
}

function makeReq(clauses) {
  function req(ctx) {
    return execReq(clauses, ctx);
  }

  req._clauses = clauses;
  return _.extend(req, reqAPI);
}

function upload(reqOpts) {
  assert(reqOpts.form);
  return Promise.promisify(function(cb) {
    var form = request(_.omit(reqOpts, 'form'), cb).form();
    _.each(reqOpts.form, function(part) {
      form.append.apply(form, part);
    });
  })();
}

function defaultHandler(reqOpts) {
  var opts = _.omit(reqOpts, 'rootUrl', 'relativeUrl');
  opts.url = reqOpts.rootUrl + reqOpts.relativeUrl;

  if (opts.body) {
    opts.body = JSON.stringify(opts.body);
  }

  var start = new Date().getTime();
  return (
    opts.form
      ? upload(opts)
      : prequest(opts)
  ).spread( function(response) {
    var end = new Date().getTime();
    return makeResult(
      response,
      opts.url,
      opts.jar,
      {
        reqStart: start,
        resEnd: end
      }
    );
  });
}

function execReq(clauses, ctx) {
  var curActor = ctx.currentActor();
  if (clauses.reqOpts.headerFns) {
    var moreHeaders = _.map(clauses.reqOpts.headerFns, function(fn) {
      return fn(ctx);
    });
    clauses.reqOpts.headers = clauses.reqOpts.headers || {};
    _.extend.apply(null, [clauses.reqOpts.headers].concat(moreHeaders));
  }
  var reqOpts = _.extend(
    ctx.stash.substitute( _.omit(clauses.reqOpts, 'relativeUrl', 'form') ),
    { relativeUrl: ctx.stash.substituteRoute(clauses.reqOpts.relativeUrl) },
    clauses.reqOpts.form ? {form: clauses.reqOpts.form} : {},
    { jar: ctx.jarForCurrentActor(request.jar) }
  );
  return clauses.handler(reqOpts)
  .then(function(res) {
    if (clauses.log) {
      console.log("log:");
      console.log("vvvvvvvvv");
      console.log(_.pick(res, 'headers', 'body', 'text'));
      console.log("^^^^^^^^^");
    }
    return (
      clauses.expectations.length
        ? Promise.map(clauses.expectations, function(expectation) {
          return expectation(ctx, res);
        })
        : clauses.defaultExpectation
          ? clauses.defaultExpectation(ctx, res)
          : Promise.resolve()
    )
    .then(function() {
      ctx.emit('request end', ctx.stack, curActor, reqOpts, res);
      _.map(clauses.stashers, function(stasher) {
        stasher(ctx, res);
      });
    })
    .then(function() {
      return ctx;
    });
  });
}

function decode(data, encoding) {
  return (
    encoding === 'gzip'
      ? zlib.gunzipAsync(data)
      : encoding === 'deflate'
        ? zlib.inflateAsync(data)
        : Promise.resolve(data)
  )
  .then(function(decoded) {
    return decoded && decoded.toString("utf8");
  });
}

function makeResult(response, url, jar, profile) {
  profile = _.clone(profile);
  profile.size = response.body.length;
  return decode(
    response.body,
    response.headers['content-encoding']
  ).then(function(decoded) {
    profile.sizeDecoded = decoded.length;

    var result = {};
    result.text = decoded;
    try {
      result.body = JSON.parse(result.text);
    } catch(e) {
      result.body = result.text;
    }
    result.response = response;
    result.headers = response.headers;
    result.statusCode = response.statusCode;
    result.profile = profile;
    var cookieHeader = response.headers['set-cookie'] || [];
    result.cookies = _.map(
      _.isArray(cookieHeader) ? cookieHeader : [cookieHeader],
      _.compose(_.clone, Cookie.parse));
    return result;
  });
}

function existy(val) {
  return (val !== undefined && val !== null);
}
