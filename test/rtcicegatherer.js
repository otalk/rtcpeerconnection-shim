/*
 *  Copyright (c) 2018 Philipp Hancke. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* eslint-env node */
'use strict';

const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
chai.use(require('dirty-chai'));
chai.use(require('sinon-chai'));

const mockORTC = require('./ortcmock');

const shimIceGatherer = require('../rtcicegatherer');

// this detects that we are not running in a browser.
const mockWindow = typeof window === 'undefined';

describe('RTCIceGatherer wrapper', () => {
  const options = {
    iceServers: [],
    gatherPolicy: 'all'
  };
  beforeEach(() => {
    if (mockWindow) {
      global.window = {};
      mockORTC(window);
    }
    window.RTCIceGatherer = shimIceGatherer(window);
  });

  let clock;
  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });
  afterEach(() => {
    clock.restore();
  });

  describe('state property', () => {
    it('exists on the prototype', () => {
      expect(window.RTCIceGatherer.prototype).to.have.property('state');
    });

    it('is set to `new` initially', () => {
      const g = new window.RTCIceGatherer(options);
      expect(g.state).to.equal('new');
    });
  });

  describe('statechange event', () => {
    it('is emitted', () => {
      const g = new window.RTCIceGatherer(options);
      const stub = sinon.stub();
      g.addEventListener('statechange', stub);
      g.onstatechange = sinon.stub();
      clock.tick(500);
      expect(stub).to.have.been.called();
      expect(g.onstatechange).to.have.been.called();
    });

    it('goes to gathering and complete', () => {
      const g = new window.RTCIceGatherer(options);
      const states = [];
      g.addEventListener('statechange', () => states.push(g.state));
      clock.tick(500);
      expect(states).to.deep.equal(['gathering', 'complete']);
    });
  });

  describe('getLocalCandidates', () => {
    it('returns an empty array initially', () => {
      const g = new window.RTCIceGatherer(options);
      expect(g.getLocalCandidates()).to.deep.equal([]);
    });

    it('returns the native local candidates after gathering', () => {
      const g = new window.RTCIceGatherer(options);
      clock.tick(500);
      expect(g.getLocalCandidates()).to.have.length(1);
    });
  });
});
