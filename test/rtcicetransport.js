/*
 *  Copyright (c) 2018 rtcpeerconnection-shim authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
chai.use(require('dirty-chai'));
chai.use(require('sinon-chai'));

const mockORTC = require('./ortcmock');

const shimIceGatherer = require('../rtcicegatherer');
const shimIceTransport = require('../rtcicetransport');

// this detects that we are not running in a browser.
const mockWindow = typeof window === 'undefined';

describe('RTCIceTransport wrapper', () => {
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
    window.RTCIceTransport = shimIceTransport(window);
  });

  let clock;
  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });
  afterEach(() => {
    clock.restore();
  });

  describe('getLocalParameters', () => {
    it('throws InvalidStateError when called before gatherer is set', () => {
      const t = new window.RTCIceTransport();
      const getParameters = () => {
        return t.getLocalParameters();
      };
      expect(getParameters).to.throw()
        .that.has.property('name').that.equals('InvalidStateError');
    });

    it('returns the ice gatherers parameters when gatherer is set', () => {
      const g = new window.RTCIceGatherer(options);
      const t = new window.RTCIceTransport(g);
      const transportParameters = t.getLocalParameters();

      expect(transportParameters).to.be.an('Object');
    });
  });

  describe('getLocalCandidates', () => {
    it('returns an empty array when called before gatherer is set', () => {
      const t = new window.RTCIceTransport();
      const candidates = t.getLocalCandidates();

      expect(candidates).to.have.length(0);
    });

    it('returns the ice gatherers candidates when gatherer is set', () => {
      const g = new window.RTCIceGatherer(options);
      const t = new window.RTCIceTransport(g);

      clock.tick(500);

      const candidates = t.getLocalCandidates();
      expect(candidates).to.deep.equal(g.getLocalCandidates());
    });
  });

  describe('gatheringstate', () => {
    it('returns new if no gatherer is set', () => {
      const t = new window.RTCIceTransport();
      expect(t.gatheringState).to.equal('new');
    });

    it('returns the gatherers state when set', () => {
      const g = new window.RTCIceGatherer(options);
      const t = new window.RTCIceTransport(g);

      clock.tick(500);
      expect(t.gatheringState).to.equal(g.state);
    });

    it('gatheringstatechange is emitted', () => {
      const g = new window.RTCIceGatherer(options);
      const t = new window.RTCIceTransport(g);

      const stub = sinon.stub();
      t.addEventListener('gatheringstatechange', stub);
      t.ongatheringstatechange = sinon.stub();

      clock.tick(500);

      expect(stub).to.have.been.called();
      expect(t.ongatheringstatechange).to.have.been.called();
    });

    it('goes to gathering and complete', () => {
      const g = new window.RTCIceGatherer(options);
      const t = new window.RTCIceTransport(g);
      const states = [];
      t.addEventListener('gatheringstatechange', () => states.push(g.state));

      clock.tick(500);
      expect(states).to.deep.equal(['gathering', 'complete']);
    });

    it('throws an error when trying to add ongatheringstatechange ' +
       'when there is no gatherer yet', () => {
      const t = new window.RTCIceTransport();
      const listen = () => {
        return t.ongatheringstatechange = () => {};
      };
      expect(listen).to.throw();
    });

    it('removes the gatherers statechange event ' +
       'when unsetting ongatheringstatechange', () => {
      const g = new window.RTCIceGatherer(options);
      const t = new window.RTCIceTransport(g);
      const spy = sinon.spy(g, 'removeEventListener');
      t.ongatheringstatechange = () => {};
      t.ongatheringstatechange = null;
      expect(spy).to.have.been.called();
    });
  });

  describe('getSelectedCandidatePair', () => {
    it('calls getNominatedCandidatePair', () => {
      const t = new window.RTCIceTransport();
      sinon.spy(t, 'getNominatedCandidatePair');
      t.getSelectedCandidatePair();
      expect(t.getNominatedCandidatePair).to.have.been.called();
    });
  });
});
