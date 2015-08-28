window.setImmediate = window.setImmediate || function(fn) { setTimeout(fn, 0) }

var url = require('url')
  , parse = require('parseurl')
  , ready = require('detect-dom-ready')
  , delegate = require('component-delegate')
  , serialize = require('form-serialize')

var Router = require('express/lib/router')
  , middleware = require('express/lib/middleware/init')
  , query = require('express/lib/middleware/query')
  , debug = require('debug')('express:application')
  , flatten = require('array-flatten')
  , slice = Array.prototype.slice

var Application = module.exports = function Application() {
	if (!(this instanceof Application)) 
		return new Application
	
	this.cache = {}
	this.engines = {}
	this.settings = {}

	this._router = new Router()
	this._router.use(query())
	this._router.use(middleware.init(this))

	window.app = this
}

var app = Application.prototype

app.use = function use(fn) {
	var offset = 0;
	var path = '/';

	// default path to '/'
	// disambiguate app.use([fn])
	if (typeof fn !== 'function') {
		var arg = fn;

		while (Array.isArray(arg) && arg.length !== 0) {
			arg = arg[0];
		}

		// first arg is the path
		if (typeof arg !== 'function') {
			offset = 1;
			path = fn;
		}
	}

	var fns = flatten(slice.call(arguments, offset));

	if (fns.length === 0) {
		throw new TypeError('app.use() requires middleware functions');
	}

	// setup router
	var router = this._router;

	fns.forEach(function (fn) {
		// non-express app
		if (!fn || !fn.handle || !fn.set) {
			return router.use(path, fn);
		}

		debug('.use app under %s', path);
		fn.mountpath = path;
		fn.parent = this;

		// restore .app property on req and res
		router.use(path, function mounted_app(req, res, next) {
			var orig = req.app;
			fn.handle(req, res, function (err) {
				req.__proto__ = orig.request;
				res.__proto__ = orig.response;
				next(err);
			});
		});

		// mounted an app
		fn.emit('mount', this);
	}, this);

	return this;
}

app.set = function set(setting, val) {
	if (arguments.length === 1) {
		// app.get(setting)
		return this.settings[setting];
	}

	debug('set "%s" to %o', setting, val);

	// set value
	this.settings[setting] = val;

	return this
}

app.path = function path() {
  return this.parent
    ? this.parent.path() + this.mountpath
    : '';
};

app.enabled = function enabled(setting) {
  return Boolean(this.set(setting));
};

app.disabled = function disabled(setting) {
  return !this.set(setting);
};

app.enable = function enable(setting) {
  return this.set(setting, true);
};

app.disable = function disable(setting) {
  return this.set(setting, false);
};

app.createRequest = function createRequest(req) {
	if(typeof req == 'string')
		req = { url:req }

	if(!req || !req.url)
		throw new Error('Your request must have a url')

	req.url = url.resolve(window.location.href, req.url)

	req.method = req.method ? req.method.toUpperCase() : 'GET'
	req.headers = req.headers || {}
	req.headers.referer = window.location.href

	req.hostname = window.location.hostname

	defineGetter(req, 'path', function path() {
		return parse(this).pathname;
	})

	req.get =
	req.header = function header(name) {
		var lc = name.toLowerCase()

		switch (lc) {
			case 'referer':
			case 'referrer':
				return this.headers.referrer || this.headers.referer
			default:
				return this.headers[lc]
		}
	}

	return req
}

app.createResponse = function createResponse() {
	var res = {
		redirect: this.redirect.bind(this)
	}

	return res
}

app.handle = function handle(req, res, done) {
	var router = this._router;

	// no routes
	if (!router) {
		debug('no routes defined on app');
		return done();
	}

	router.handle(req, res, done)
}

app.navigate = function navigate(request, options) {
	var req = this.createRequest(request)
	  , res = this.createResponse()
	  , parts = parse(req)
	  , app = this

	options = options || {}

	if(parts.host != window.location.host) {
		return false
	}

	if(options.replace) {
		if(window.location.href != req.url) {
			window.history.replaceState({}, '', req.url)
		}
	} else {
		window.history.pushState({}, '', req.url)
	}

	this.handle(req, res, options.done || function(err) {
		if(err) return console.error(err)
		else if(options.replace) window.location.reload()
		else window.location = window.location.href
	})

	return true
}

app.redirect = function redirect(req) {
	return this.navigate(req, { replace:true })
}

app.refresh = function refresh() {
	return this.redirect(window.location.href)
}

app.start = function start() {
	var app = this
	
	ready(function() {

		delgateBody('a[href]', 'click', function(e) {
			if(app.navigate(e.delegateTarget.href)) {
				e.stopPropagation()
				e.preventDefault()
				return false
			}
		})
		
		delgateBody('form[action]', 'submit', function(e) {
			var req = { 
				method: 'POST', 
				url: e.delegateTarget.action, 
				body: serialize(e.delegateTarget, { hash:true }) 
			}

			if(app.navigate(req)) {
				e.stopPropagation()
				e.preventDefault()
				return false
			}
		})
	})

	window.addEventListener('popstate', function(e) {
		if('state' in window.history && window.history.state !== null) app.refresh()
	})
}

function delgateBody(selector, event, handler) {
	delegate.bind(document.body, selector, event, function(e) {
		if(!e.defaultPrevented) {
			return handler(e)
		}
	})
}

function defineGetter(obj, name, getter) {
	Object.defineProperty(obj, name, {
		configurable: true,
		enumerable: true,
		get: getter
	})
}