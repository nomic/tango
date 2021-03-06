'use strict';
var _ = require('lodash'),
    Promise = require('bluebird'),
    context = require('./lib/context'),
    helper = require('./lib/helper');

module.exports = run;

_.extend(
  run,
  {
    runWithContext: runWithContext,
    as: as,
    sequentially: sequentially,
    concurrently: concurrently,
    step: step,
    stash: stash,
    eventually: eventually,
    wait: wait,
    pass: pass
  },
  context,
  require('./lib/req')
);

function runWithContext(ctx /*, cmds...*/) {
  return sequentially.apply(null, _.rest(arguments))(ctx);
}

function run(/*cmds...*/) {
  return sequentially.apply(null, arguments)(new context.Context());
}

function as(alias /*, cmds* */) {
  var cmds = _conformCommands(_.rest(arguments));
  if (cmds.length) {
    return function(ctx) {
      var prevActor = ctx.currentActor();
      ctx.setCurrentActor(alias);
      return _sequence(ctx, cmds)
      .then(function(ctx) {
        ctx.setCurrentActor(prevActor);
        return ctx;
      });
    };
  }

  return function(ctx) {
    ctx.setCurrentActor(alias);
    return ctx;
  };
}

function sequentially() {
  var cmds = _conformCommands(_.toArray(arguments));
  return function(ctx) {
    return _sequence(ctx, cmds);
  };
}

function pass() {
  return sequentially();
}

function concurrently() {
  var cmds = _conformCommands(_.toArray(arguments));
  helper.validate(_.all(cmds, _.isFunction), 'Commands must be functions: ' + cmds);
  return function(ctx) {
    return Promise.map(cmds, function(cmd) {
      return cmd(ctx.branch());
    })
    .then(function() {
      return ctx;
    });
  };
}

function step(title /*, cmds* */) {
  helper.validate(title, 'Invalid title: ' + title);
  var cmds = _conformCommands(_.rest(arguments));
  return function(ctx) {
    ctx.emit('step', title);
    ctx.stack.push(title);
    return _sequence(ctx, cmds)
    .then(function(ctx) {
      if (ctx) ctx.stack.pop();
      return ctx;
    });
  };
}

function stash(key, val) {
  return function(ctx) {
    ctx.stash.set(key, val);
    return ctx;
  };
}

function eventually(fn, opts) {
  opts =_.defaults(opts || {}, {
    delay: 2,
    timeout: 5000,
    report: _.noop
  });
  return function() {
    var args = arguments;
    var boundFn = function() {
      return fn.apply(null, args);
    };
    return _untilResolved(boundFn, opts.delay, opts.timeout, opts.report, 0);
  };
}

function wait(millis) {
  return function(ctx) {
    return Promise.delay(millis)
      .then(function() {
        return ctx;
      });
  };
}

function _sequence(ctx, cmds) {
  return cmds.length
    ? Promise.try(cmds.slice(0,1)[0], ctx)
      .then(function(ctx) {
        return _sequence(ctx, cmds.slice(1));
      })
    : Promise.resolve(ctx);
}

function _untilResolved(fn, delay, timeout, report, elapsed) {
  return Promise.try(fn)
  .then(null, function(err) {
    if (elapsed > timeout) throw err;
    report('Retrying in ' + delay + ' ms');
    return Promise.delay(delay).then(function() {
      return _untilResolved(fn, delay * 2, timeout, report, delay + elapsed);
    });
  });
}

function _conformCommands(cmds) {
  cmds = _.flattenDeep(cmds);
  helper.validate(
    _.all(cmds, _.isFunction),
    'Driver commands must be functions: [' + cmds + ']'
  );
  return cmds;
}
