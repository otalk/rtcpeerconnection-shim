/*
 *  Copyright (c) 2017 rtcpeerconnection-shim authors. All Rights Reserved.
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
const mockGetUserMedia = require('./gummock');

const shimSenderWithTrackOrKind = require('../rtcrtpsender');

// this detects that we are not running in a browser.
const mockWindow = typeof window === 'undefined';

describe('RTCRtpSender wrapper', () => {
  const kind = 'audio';
  let nativeConstructorStub;
  let sender;
  let track;
  let transport;

  beforeEach(() => {
    if (mockWindow) {
      global.window = {};
      mockORTC(window);
      mockGetUserMedia(window);

      track = new window.MediaStreamTrack();
      track.kind = kind;

      transport = new window.RTCDtlsTransport();
    }
  });

  describe('allows constructing RTCRtpSender with', () => {
    beforeEach(() => {
      nativeConstructorStub = sinon.stub(window, 'RTCRtpSender');
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });
    afterEach(() => {
      nativeConstructorStub.restore();
    });

    describe('only a kind', () => {
      beforeEach(() => {
        sender = new window.RTCRtpSender(kind);
      });

      it('sets sender.kind', () => {
        expect(sender.kind).to.equal(kind);
      });

      it('does not call the native constructor', () => {
        expect(nativeConstructorStub).not.to.have.been.called();
      });
    });

    describe('only a track', () => {
      beforeEach(() => {
        sender = new window.RTCRtpSender(track);
      });

      it('sets sender.kind', () => {
        expect(sender.kind).to.equal(kind);
      });

      it('does not call the native constructor', () => {
        expect(nativeConstructorStub).not.to.have.been.called();
      });
    });

    describe('a track and a transport', () => {
      beforeEach(() => {
        sender = new window.RTCRtpSender(track, transport);
      });

      it('sets sender.kind', () => {
        expect(sender.kind).to.equal(kind);
      });

      it('calls the native constructor', () => {
        expect(nativeConstructorStub).to.have.been.called();
      });
    });
  });

  describe('when constructed with', () => {
    beforeEach(() => {
      nativeConstructorStub = sinon.stub(window, 'RTCRtpSender');
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });

    it('track it calls the constructor after setTransport', () => {
      sender = new window.RTCRtpSender(track);
      sender.setTransport(transport);

      expect(nativeConstructorStub).to.have.been.called();
    });

    ['setTrack', 'replaceTrack'].forEach((setOrReplaceTrack) => {
      it('kind it calls the constructor after ' + setOrReplaceTrack +
         ' and setTransport', () => {
        sender = new window.RTCRtpSender(kind);
        sender[setOrReplaceTrack](track);
        sender.setTransport(transport);

        expect(nativeConstructorStub).to.have.been.called();
      });

      it('kind and transport it calls the constructor after ' +
         setOrReplaceTrack, () => {
        sender = new window.RTCRtpSender(kind, transport);
        sender[setOrReplaceTrack](track);

        expect(nativeConstructorStub).to.have.been.called();
      });
    });
  });

  describe('track attribute', () => {
    beforeEach(() => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });

    it('returns the track when constructed with track', () => {
      sender = new window.RTCRtpSender(track);
      expect(sender.track).to.equal(track);
    });

    it('returns the track when constructed with track and transport', () => {
      sender = new window.RTCRtpSender(track, transport);
      expect(sender.track).to.equal(track);
    });

    it('returns null when constructed with kind', () => {
      sender = new window.RTCRtpSender(kind);
      expect(sender.track).to.equal(null);
    });
  });

  describe('transport attribute', () => {
    beforeEach(() => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });

    it('returns null when constructed with kind', () => {
      sender = new window.RTCRtpSender(kind);
      expect(sender.transport).to.equal(null);
    });

    it('returns null when constructed with track', () => {
      sender = new window.RTCRtpSender(track);
      expect(sender.transport).to.equal(null);
    });

    it('returns the transport when constructed with kind and transport', () => {
      sender = new window.RTCRtpSender(kind, transport);
      expect(sender.transport).to.equal(transport);
    });

    it('returns the transport when constructed with track ' +
        'and transport', () => {
      sender = new window.RTCRtpSender(track, transport);
      expect(sender.transport).to.equal(transport);
    });
  });

  describe('setTransport', () => {
    it('calls the native constructor when construced with track', () => {
      nativeConstructorStub = sinon.stub(window, 'RTCRtpSender');
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);

      sender = new window.RTCRtpSender(track);
      sender.setTransport(transport);
      expect(nativeConstructorStub).to.have.been.called();
    });

    it('calls the native setTransport', () => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);

      sender = new window.RTCRtpSender(track, transport);
      const nativeSetTransport = sinon.stub(sender._sender, 'setTransport');

      const transport2 = new window.RTCDtlsTransport();
      sender.setTransport(transport2);
      expect(nativeSetTransport).to.have.been.called();
    });

    it('sets the transport when constructed with only kind', () => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);

      sender = new window.RTCRtpSender(kind);
      sender.setTransport(transport);
      expect(sender.transport).to.equal(transport);
    });
  });

  ['setTrack', 'replaceTrack'].forEach((setOrReplaceTrack) => {
    describe(setOrReplaceTrack, () => {
      beforeEach(() => {
        window.RTCRtpSender = shimSenderWithTrackOrKind(window);
        sender = new window.RTCRtpSender(track, transport);
      });

      it('rejects when the new tracks kind does not match', (done) => {
        const newTrack = new window.MediaStreamTrack();
        newTrack.kind = 'somethingElse';
        sender[setOrReplaceTrack](newTrack)
          .catch((err) => {
            done();
          });
      });

      it('calls the native ' + setOrReplaceTrack, () => {
        const nativeStub = sinon.stub(sender._sender, setOrReplaceTrack);
        sender[setOrReplaceTrack](null);
        expect(nativeStub).to.have.been.called();
      });
    });
  });

  describe('send', () => {
    beforeEach(() => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });

    it('calls the native send method if a native sender exists', () => {
      sender = new window.RTCRtpSender(track, transport);
      const nativeSend = sinon.stub(sender._sender, 'send');

      sender.send('mock parameters');
      expect(nativeSend).to.have.been.called();
    });

    it('rejects with InvalidTypeError when the native sender ' +
       'does not exist', (done) => {
      sender = new window.RTCRtpSender(kind, transport);
      sender.send('mock parameters')
        .catch((err) => {
          done();
        });
    });
  });
  describe('stop', () => {
    beforeEach(() => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });

    it('stops the native sender if it exists', () => {
      sender = new window.RTCRtpSender(track, transport);
      const nativeStop = sinon.stub(sender._sender, 'stop');

      sender.stop();
      expect(nativeStop).to.have.been.called();
    });
  });

  describe('dtmf', () => {
    beforeEach(() => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });

    it('throws InvalidStateError when accessed without a native sender', () => {
      sender = new window.RTCRtpSender(kind);
      const accessor = () => {
        return sender.dtmf;
      };
      expect(accessor).to.throw()
        .that.has.property('name').that.equals('InvalidStateError');
    });

    it('exists on audio senders', () => {
      sender = new window.RTCRtpSender(track, transport);
      const dtmf = sender.dtmf;
      expect(dtmf).not.to.equal(null);
      expect(dtmf).to.have.property('insertDTMF');
    });

    it('does not exist on video senders', () => {
      sender = new window.RTCRtpSender('video');
      expect(sender.dtmf).to.equal(null);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      window.RTCRtpSender = shimSenderWithTrackOrKind(window);
    });

    it('calls the native senders getStats', (done) => {
      sender = new window.RTCRtpSender(track, transport);
      const nativeGetStats = sinon.stub(sender._sender, 'getStats')
        .returns(Promise.resolve());

      sender.getStats()
        .then(() => {
          expect(nativeGetStats).to.have.been.called();
          done();
        });
    });

    it('rejects with InvalidStateError when called without a ' +
        'native sender', (done) => {
      sender = new window.RTCRtpSender(kind);
      sender.getStats()
        .catch((err) => {
          done();
        });
    });
  });
});
