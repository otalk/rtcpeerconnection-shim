/*
 *  Copyright (c) 2017 Philipp Hancke. All Rights Reserved.
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
const mockGetUserMedia = require('./gummock');

const shimReceiver = require('../rtcrtpreceiver');

// this detects that we are not running in a browser.
const mockWindow = typeof window === 'undefined';

describe('RTCRtpReceiver wrapper', () => {
  const kind = 'audio';
  let nativeConstructorStub;
  let receiver;
  let transport;

  beforeEach(() => {
    if (mockWindow) {
      global.window = {};
      mockORTC(window);
      mockGetUserMedia(window);

      transport = new window.RTCDtlsTransport();
    }
  });

  describe('allows constructing RTCRtpReceiver with', () => {
    beforeEach(() => {
      nativeConstructorStub = sinon.stub(window, 'RTCRtpReceiver');
      window.RTCRtpReceiver = shimReceiver(window);
    });
    afterEach(() => {
      nativeConstructorStub.restore();
    });

    describe('only a kind', () => {
      beforeEach(() => {
        receiver = new window.RTCRtpReceiver(null, kind);
      });

      it('sets receiver.kind', () => {
        expect(receiver.kind).to.equal(kind);
      });

      it('does not call the native constructor', () => {
        expect(nativeConstructorStub).not.to.have.been.called();
      });
    });

    describe('a kind and a transport', () => {
      beforeEach(() => {
        receiver = new window.RTCRtpReceiver(transport, kind);
      });

      it('sets receiver.kind', () => {
        expect(receiver.kind).to.equal(kind);
      });

      it('calls the native constructor', () => {
        expect(nativeConstructorStub).to.have.been.called();
      });
    });
  });

  describe('when constructed with', () => {
    beforeEach(() => {
      nativeConstructorStub = sinon.stub(window, 'RTCRtpReceiver');
      window.RTCRtpReceiver = shimReceiver(window);
    });

    it('kind it calls the constructor after setTransport', () => {
      receiver = new window.RTCRtpReceiver(null, kind);
      receiver.setTransport(transport);

      expect(nativeConstructorStub).to.have.been.called();
    });
  });

  describe('transport attribute', () => {
    beforeEach(() => {
      window.RTCRtpReceiver = shimReceiver(window);
    });

    it('returns null when constructed with kind', () => {
      receiver = new window.RTCRtpReceiver(null, kind);
      expect(receiver.transport).to.equal(null);
    });

    it('returns the transport when constructed with ' +
        'kind and transport', () => {
      receiver = new window.RTCRtpReceiver(transport, kind);
      expect(receiver.transport).to.equal(transport);
    });
  });

  describe('track attribute', () => {
    beforeEach(() => {
      window.RTCRtpReceiver = shimReceiver(window);
    });

    it('returns null when constructed with kind', () => {
      receiver = new window.RTCRtpReceiver(null, kind);
      expect(receiver.track).to.equal(null);
    });

    it('returns the track when constructed with ' +
        'kind and transport', () => {
      receiver = new window.RTCRtpReceiver(transport, kind);
      expect(receiver.track).to.be.an.instanceOf(window.MediaStreamTrack);
    });
  });

  describe('setTransport', () => {
    it('sets the transport when constructed with kind', () => {
      window.RTCRtpReceiver = shimReceiver(window);

      receiver = new window.RTCRtpReceiver(null, kind);
      receiver.setTransport(transport);
      expect(receiver.transport).to.equal(transport);
    });

    it('calls the native setTransport', () => {
      window.RTCRtpReceiver = shimReceiver(window);

      receiver = new window.RTCRtpReceiver(transport, kind);

      const nativeSetTransport = sinon.stub(receiver._receiver, 'setTransport');
      const transport2 = new window.RTCDtlsTransport();
      receiver.setTransport(transport2);
      expect(nativeSetTransport).to.have.been.called();
    });
  });

  describe('receive', () => {
    beforeEach(() => {
      window.RTCRtpReceiver = shimReceiver(window);
    });

    it('calls the native send method if a native receiver exists', () => {
      receiver = new window.RTCRtpReceiver(transport, kind);
      const nativeSend = sinon.stub(receiver._receiver, 'receive');

      receiver.receive('mock parameters');
      expect(nativeSend).to.have.been.called();
    });

    it('rejects with InvalidTypeError when the native receiver ' +
       'does not exist', (done) => {
      receiver = new window.RTCRtpReceiver(null, kind);
      receiver.receive('mock parameters')
        .catch((err) => {
          done();
        });
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      window.RTCRtpReceiver = shimReceiver(window);
    });

    it('stops the native receiver if it exists', () => {
      receiver = new window.RTCRtpReceiver(transport, kind);
      const nativeStop = sinon.stub(receiver._receiver, 'stop');

      receiver.stop();
      expect(nativeStop).to.have.been.called();
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      window.RTCRtpReceiver = shimReceiver(window);
    });

    it('calls the native receivers getStats', (done) => {
      receiver = new window.RTCRtpReceiver(transport, kind);
      const nativeGetStats = sinon.stub(receiver._receiver, 'getStats')
          .returns(Promise.resolve());

      receiver.getStats()
      .then(() => {
        expect(nativeGetStats).to.have.been.called();
        done();
      });
    });

    it('rejects with InvalidStateError when called without a ' +
        'native receiver', (done) => {
      receiver = new window.RTCRtpReceiver(null, kind);
      receiver.getStats()
        .catch((err) => {
          done();
        });
    });
  });

  ['Contributing', 'Synchronization'].forEach((sourceType) => {
    const method = 'get' + sourceType + 'Sources';
    describe(method, () => {
      beforeEach(() => {
        window.RTCRtpReceiver = shimReceiver(window);
      });

      it('returns an empty list when no native receiver exists', () => {
        receiver = new window.RTCRtpReceiver(null, kind);
        const sources = receiver[method]();
        expect(sources).to.be.a('Array');
        expect(sources).to.have.length(0);
      });

      it('returns an empty list when the native receiver exists', () => {
        receiver = new window.RTCRtpReceiver(transport, kind);
        const sources = receiver[method]();
        expect(sources).to.be.a('Array');
        expect(sources).to.have.length(0);
      });
    });
  });
});
