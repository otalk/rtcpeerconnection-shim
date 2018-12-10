/*
 *  Copyright (c) 2017 rtcpeerconnection-shim authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

const EventEmitter = require('events');

const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
chai.use(require('dirty-chai'));
chai.use(require('sinon-chai'));

const util = require('../util');

describe('Utility functions', () => {
  describe('makeError', () => {
    it('returns an error object', () => {
      const err = util.makeError('name', 'description');
      expect(err).to.be.instanceOf(Error);
    });

    it('sets the error name', () => {
      const err = util.makeError('name', 'description');
      expect(err.name).to.equal('name');
    });

    it('sets the error message', () => {
      const err = util.makeError('name', 'description');
      expect(err.message).to.equal('description');
    });

    it('sets the legacy error code for some errors', () => {
      const err = util.makeError('NotSupportedError', 'description');
      expect(err.code).to.equal(9);
    });
  });

  describe('filtering of STUN and TURN servers', () => {
    const defaultVersion = 15025;
    it('converts legacy url member to urls', () => {
      const result = util.filterIceServers([
        {url: 'stun:stun.l.google.com'}
      ], defaultVersion);
      expect(result).to.deep.equal([
        {urls: 'stun:stun.l.google.com'}
      ]);
    });

    it('filters STUN before r14393', () => {
      const result = util.filterIceServers([
        {urls: 'stun:stun.l.google.com'}
      ], 14392);
      expect(result).to.deep.equal([]);
    });

    it('does not filter STUN without protocol after r14393', () => {
      const result = util.filterIceServers([
        {urls: 'stun:stun.l.google.com'}
      ], defaultVersion);
      expect(result).to.deep.equal([
        {urls: 'stun:stun.l.google.com'}
      ]);
    });

    it('does filter STUN with protocol even after r14393', () => {
      const result = util.filterIceServers([
        {urls: 'stun:stun.l.google.com:19302?transport=udp'}
      ], defaultVersion);
      expect(result).to.deep.equal([]);
    });

    it('filters incomplete TURN urls', () => {
      const result = util.filterIceServers([
        {urls: 'turn:stun.l.google.com'},
        {urls: 'turn:stun.l.google.com:19302'}
      ], defaultVersion);
      expect(result).to.deep.equal([]);
    });

    it('filters TURN TCP', () => {
      const result = util.filterIceServers([
        {urls: 'turn:stun.l.google.com:19302?transport=tcp'}
      ], defaultVersion);
      expect(result).to.deep.equal([]);
    });

    describe('removes all but the first server of a type', () => {
      it('in separate entries', () => {
        const result = util.filterIceServers([
          {urls: 'stun:stun.l.google.com'},
          {urls: 'turn:stun.l.google.com:19301?transport=udp'},
          {urls: 'turn:stun.l.google.com:19302?transport=udp'}
        ], defaultVersion);
        expect(result).to.deep.equal([
          {urls: 'stun:stun.l.google.com'},
          {urls: 'turn:stun.l.google.com:19301?transport=udp'}
        ]);
      });

      it('in urls entries', () => {
        const result = util.filterIceServers([
          {urls: 'stun:stun.l.google.com'},
          {urls: [
            'turn:stun.l.google.com:19301?transport=udp',
            'turn:stun.l.google.com:19302?transport=udp'
          ]}
        ], defaultVersion);
        expect(result).to.deep.equal([
          {urls: 'stun:stun.l.google.com'},
          {urls: ['turn:stun.l.google.com:19301?transport=udp']}
        ]);
      });
    });
  });

  describe('aliases for event listeners', () => {
    function Event(type) {
      this.type = type;
    }
    function SomeObject() {
      this._emitter = new EventEmitter();
    }
    SomeObject.prototype.addEventListener = function() {
      return this._emitter.addListener.apply(this._emitter, arguments);
    };

    SomeObject.prototype.removeEventListener = function() {
      return this._emitter.removeListener.apply(this._emitter, arguments);
    };

    SomeObject.prototype.dispatchEvent = function(ev) {
      this._emitter.emit(ev.type, ev);
      if (this['on' + ev.type]) {
        this['on' + ev.type](ev);
      }
    };

    it('does not interfere for unaliased events', () => {
      const obj = new SomeObject();
      const stub = sinon.stub();
      util.aliasEventListener(obj, 'oldname', 'newname');
      obj.addEventListener('somethingelse', stub);
      obj.dispatchEvent(new Event('somethingelse'));
      expect(stub).to.have.been.called();
    });

    it('allows aliasing an event listener', () => {
      const obj = new SomeObject();
      util.aliasEventListener(obj, 'oldname', 'newname');
      const stub = sinon.stub();
      obj.addEventListener('newname', stub);
      obj.dispatchEvent(new Event('oldname'));
      expect(stub).to.have.been.called();
    });

    it('allows setting a onalias', () => {
      const obj = new SomeObject();
      util.aliasEventListener(obj, 'oldname', 'newname');
      obj.onnewname = sinon.stub();
      obj.dispatchEvent(new Event('oldname'));
      expect(obj.onnewname).to.have.been.called();
    });

    it('removing onalias removes the event listener', () => {
      const obj = new SomeObject();
      util.aliasEventListener(obj, 'oldname', 'newname');
      obj.onnewname = sinon.stub();

      const spy = sinon.spy(obj, 'removeEventListener');
      obj.onnewname = null;
      expect(spy).to.have.been.called();
    });
  });

  describe('fixing stat type names', () => {
    it('changes outboundrtp to outbound-rtp', () => {
      expect(util.fixStatsType({type: 'outboundrtp'})).to.equal('outbound-rtp');
    });

    it('changes inboundrtp to inbound-rtp', () => {
      expect(util.fixStatsType({type: 'inboundrtp'})).to.equal('inbound-rtp');
    });

    it('changes candidatepair to candidate-pair', () => {
      expect(util.fixStatsType({type: 'candidatepair'}))
        .to.equal('candidate-pair');
    });

    it('changes localcandidate to local-candidate', () => {
      expect(util.fixStatsType({type: 'localcandidate'}))
        .to.equal('local-candidate');
    });

    it('changes remotecandidate to remote-candidate', () => {
      expect(util.fixStatsType({type: 'remote-candidate'}))
        .to.equal('remote-candidate');
    });

    it('does not modify unknown types', () => {
      expect(util.fixStatsType({type: 'something'})).to.equal('something');
    });
  });
});
