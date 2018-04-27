/*
 *  Copyright (c) 2017 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
'use strict';

module.exports = {
  makeError: function(name, description) {
    var e = new Error(description);
    e.name = name;
    // legacy error codes from https://heycam.github.io/webidl/#idl-DOMException-error-names
    e.code = {
      NotSupportedError: 9,
      InvalidStateError: 11,
      InvalidAccessError: 15,
      TypeError: undefined,
      OperationError: undefined
    }[name];
    return e;
  },
  // Edge does not like
  // 1) stun: filtered after 14393 unless ?transport=udp is present
  // 2) turn: that does not have all of turn:host:port?transport=udp
  // 3) turn: with ipv6 addresses
  // 4) turn: occurring muliple times
  filterIceServers: function(iceServers, edgeVersion) {
    var hasTurn = false;
    iceServers = JSON.parse(JSON.stringify(iceServers));
    return iceServers.filter(function(server) {
      if (server && (server.urls || server.url)) {
        var urls = server.urls || server.url;
        if (server.url && !server.urls) {
          console.warn('RTCIceServer.url is deprecated! Use urls instead.');
        }
        var isString = typeof urls === 'string';
        if (isString) {
          urls = [urls];
        }
        urls = urls.filter(function(url) {
          var validTurn = url.indexOf('turn:') === 0 &&
              url.indexOf('transport=udp') !== -1 &&
              url.indexOf('turn:[') === -1 &&
              !hasTurn;

          if (validTurn) {
            hasTurn = true;
            return true;
          }
          return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
              url.indexOf('?transport=udp') === -1;
        });

        delete server.url;
        server.urls = isString ? urls[0] : urls;
        return !!urls.length;
      }
    });
  },

  /* creates an alias name for an event listener */
  aliasEventListener: function(obj, eventName, alias) {
    ['addEventListener', 'removeEventListener'].forEach(function(method) {
      var nativeMethod = obj[method];
      obj[method] = function(nativeEventName, cb) {
        if (nativeEventName !== alias) {
          return nativeMethod.apply(this, arguments);
        }
        return nativeMethod.apply(this, [eventName, cb]);
      };
    });

    Object.defineProperty(obj, 'on' + alias, {
      get: function() {
        return this['_on' + alias];
      },
      set: function(cb) {
        if (this['_on' + alias]) {
          this.removeEventListener(alias, this['_on' + alias]);
          delete this['_on' + alias];
        }
        if (cb) {
          this.addEventListener(alias, this['_on' + alias] = cb);
        }
      }
    });
  }
};
