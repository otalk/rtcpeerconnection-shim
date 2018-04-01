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
chai.use(require('dirty-chai'));
chai.use(require('sinon-chai'));

const util = require('../util');

describe('Utility functions', () => {
  const defaultVersion = 15025;
  describe('filtering of STUN and TURN servers', () => {
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
});
