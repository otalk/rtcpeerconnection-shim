/*
 *  Copyright (c) 2018 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
'use strict';

/* a wrapper around Edge's RTCIceGatherer that adds state and onstatechange
 * and hides a bug in getLocalCandidates which throws if called before
 * there was at least one candidate gathered.
 */
module.exports = function(window) {
  var NativeRTCIceGatherer = window.RTCIceGatherer;
  Object.defineProperty(window.RTCIceGatherer.prototype, 'state',
    {value: 'new', writable: true});
  var RTCIceGatherer = function(options) {
    var gatherer = new NativeRTCIceGatherer(options);
    gatherer.addEventListener('localcandidate', function(e) {
      var candidate = e.candidate;
      var end = !candidate || Object.keys(candidate).length === 0;
      if (end) {
        gatherer.state = 'complete';
        gatherer.dispatchEvent(new Event('icegatheringstatechange'));
      } else if (gatherer.state === 'new') {
        gatherer.state = 'gathering';
        gatherer.dispatchEvent(new Event('icegatheringstatechange'));
      }
    });
    return gatherer;
  };
  RTCIceGatherer.prototype = NativeRTCIceGatherer.prototype;

  var origGetLocalCandidates = RTCIceGatherer.prototype.getLocalCandidates;
  RTCIceGatherer.prototype.getLocalCandidates = function() {
    if (this.state === 'new') {
      return [];
    }
    return origGetLocalCandidates.apply(this);
  };
  return RTCIceGatherer;
};
