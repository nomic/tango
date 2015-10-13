"use strict";

var util = require("util"),
      _ = require("lodash"),
      jsondiff = require("json-diff"),
      Promise = require("bluebird");

function existy(val) {
  return val !== undefined && val !== null;
}

function checkJSONExpression(expression, json, opts) {
  opts = opts || {};
  // array expressions never match non-arrays or arrays of a different length.
  if (_.isArray(expression) && !(_.isArray(json) && expression.length === json.length)) {
    return false;
  }

  var sufficientKeys = !opts.strict || (
    _.isObject(expression) && sameKeys(expression, json));

  if (_.isPlainObject(expression) || _.isArray(expression)) {

    if (_.isEmpty(expression)) return sufficientKeys;

    return _.all(expression, function(v, k) {

      // check "$" properties
      if (k === "$strict") return (
        checkJSONExpression(v, json, _.defaults({strict: true}, opts)));
      if (k === "$not") return (
        !checkJSONExpression(v, json, _.defaults({strict: false}, opts)));
      if (k === "$unordered") {
        return v.length === json.length && arrayContains(json, v, opts);
      }
      if (k === "$contains") {
        return arrayContains(json, v, opts);
      }
      if (k === "$length" ) return(v === json.length);
      if (k === "$gt") return (json > v);
      if (k === "$gte") return (json >= v);
      if (k === "$lt") return (json < v);
      if (k === "$lte") return (json <= v);

      return _.isObject(json)
        && sufficientKeys
        && checkJSONExpression(v, json[k], opts);

    });
  }

  if (_.isRegExp(expression)) return expression.test(json);

  if (expression === "$exists") return existy(json);
  if (expression === "$string") return _.isString(json);
  if (expression === "$date") {
    try {
      new Date(json);
      return true;
    } catch (e) {
      return false;
    }
  }
  if (expression === "$int") {
    //http://stackoverflow.com/questions/3885817/how-to-check-if-a-number-is-float-or-integer
    return (typeof json === 'number' && json % 1 === 0);
  }

  return (expression === json);
}

function sameKeys(a, b) {
  return _.isEqual(_.sortBy(_.keys(a)), _.sortBy(_.keys(b)));
}

function arrayContains(haystack, needles, opts) {
  // We're dealing with an unordered array comparison so we check values
  // such that order doesn't matter.  We want to make sure that all values
  // in the subset have a match.
  var haystackCopy = _.clone(haystack);
  return _.all(needles, function(elem) {
    // Does the _deepIncludes test pass for any index?
    return _.any(haystackCopy, function(superElem, i) {
      if ( checkJSONExpression({0: elem}, {0: superElem}, opts) ) {
        delete haystackCopy[i];
        return true;
      }
      return false;
    });
  });
};

//
// Expectation Failures
//
var ExpectationError = function (msg, constr) {
  Error.captureStackTrace(this, constr || this);
  this.message = msg || 'Error';
};
util.inherits(ExpectationError, Error);
exports.ExpectationError = ExpectationError;

var fail = exports.fail = function(msg, name, trace) {
  msg += "\n"+trace;
  msg += "\n";
  var err = new ExpectationError(msg);
  err.name = name;
  return err;
};

var statusFail = exports.statusFail = function(actual, expected, actualBody, trace) {
  var msg =
    "Expected HTTP status code of " + expected + " but got " + actual +
    "\nResponse Body:\n"+JSON.stringify(actualBody, null, 4);

  return fail(msg, "Status Failure", trace);
};

var jsonExpressionFail = exports.jsonExpressionFail  = function(actual, expression, trace) {
  var msg;
  msg  = "\nExpected:\n" + expression +
         "\nBut not found in:\n" + actual;
  msg = "\n(expression diffed against actual follows)\n" + jsondiff.diffString(expression, actual);

  return fail(msg, "JSON Expression Failure", trace);
};

var textFail = exports.bodyFail = function(actual, text, trace) {
  var msg = "\nExpected:\n" + text +
            "\nBut not found:\n" + actual;

  return fail(msg, "Text Comparison Failure", trace);
};

var predicateFail = exports.predicateFail =  function(actual, predicate, trace) {
  var msg  = "\nExpected:\n" + predicate +
             "\nBut predicate not satisfied for:\n" + trace;

  return fail(msg, "Predicate Failure", trace);
};


function expectFn(actual, fn, trace) {
  return Promise.try(function() {
    return fn(actual.body, actual);
  })
  .catch(function(err) {
    var expectError = fail("", "Expectation Function Failed:\n" + err, trace);
    throw expectError;
  });
}
//
// The main interface to this module.
//
// Pass in the trace that will be given along with the failure
//

exports.expect = function(actual, expected, trace, opts) {

  return Promise.try(function() {
    if (expected.statusCode && expected.statusCode !== actual.statusCode) {
      throw statusFail(actual.statusCode, expected.statusCode, actual.body, trace);
    }

    if ( expected.body ) {
      if ( _.isRegExp(expected.body) && ! expected.body.test(actual.text) ) {
        throw textFail('"' + actual.text + '"', expected.body.toString(), trace );
      }

      if ( _.isString(expected.body) && expected.body !== actual.text ) {
        throw textFail( '"' + actual.text + '"', '"' + expected.body + '"', trace );
      }

      if ( _.isFunction(expected.body) ) return expectFn(actual, expected.body, trace);

      if (    ! _.isRegExp(expected.body)
           && ! _.isString(expected.body)
              && ! checkJSONExpression(expected.body, actual.body, opts) ) {
        throw jsonExpressionFail( actual.body, expected.body, trace );
      }
    }
  })
  .then(null, function(err) {
    err.actual = actual;
    throw err;
  });

};

// only exporting this for test purposes.
exports.checkJSONExpression = checkJSONExpression;
exports.expectFn = expectFn;
exports.test = function(actual, expected) {
  if (_.isFunction(expected)) {
    return expectFn(actual, expected, '')
      .then(function() { return true; }, function() { return false; });
  } else {
    return Promise.resolve(
      checkJSONExpression(expected, actual)
    );
  }
};
