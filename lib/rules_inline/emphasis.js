// Process *this* and _that_
//
'use strict';


var isWhiteSpace   = require('../common/utils').isWhiteSpace;
var isPunctChar    = require('../common/utils').isPunctChar;
var isMdAsciiPunct = require('../common/utils').isMdAsciiPunct;


// parse sequence of emphasis markers,
// "start" should point at a valid marker
function scanDelims(state, start) {
  var pos = start, lastChar, nextChar, count, can_open, can_close,
      isLastWhiteSpace, isLastPunctChar,
      isNextWhiteSpace, isNextPunctChar,
      left_flanking = true,
      right_flanking = true,
      max = state.posMax,
      marker = state.src.charCodeAt(start);

  // treat beginning of the line as a whitespace
  lastChar = start > 0 ? state.src.charCodeAt(start - 1) : 0x20;

  while (pos < max && state.src.charCodeAt(pos) === marker) { pos++; }

  count = pos - start;

  // treat end of the line as a whitespace
  nextChar = pos < max ? state.src.charCodeAt(pos) : 0x20;

  isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
  isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));

  isLastWhiteSpace = isWhiteSpace(lastChar);
  isNextWhiteSpace = isWhiteSpace(nextChar);

  if (isNextWhiteSpace) {
    left_flanking = false;
  } else if (isNextPunctChar) {
    if (!(isLastWhiteSpace || isLastPunctChar)) {
      left_flanking = false;
    }
  }

  if (isLastWhiteSpace) {
    right_flanking = false;
  } else if (isLastPunctChar) {
    if (!(isNextWhiteSpace || isNextPunctChar)) {
      right_flanking = false;
    }
  }

  if (marker === 0x5F /* _ */) {
    // "_" inside a word can neither open nor close an emphasis
    can_open  = left_flanking  && (!right_flanking || isLastPunctChar);
    can_close = right_flanking && (!left_flanking  || isNextPunctChar);
  } else {
    can_open  = left_flanking;
    can_close = right_flanking;
  }

  return {
    can_open:  can_open,
    can_close: can_close,
    length:    count
  };
}


function calculateNextPair(state, cache) {
  var ch, currDelim, lastDelim, delimiters, delimiter, i, j, oldPos, scanned,
      max = state.posMax;

  if (cache.last >= max) { return false; }

  delimiters = cache.delimiters;
  oldPos = state.pos;
  state.pos = cache.last;

  for (;;) {
    ch = state.src.charCodeAt(state.pos);

    if (ch === 0x5F/* _ */ || ch === 0x2A /* * */) {
      scanned = scanDelims(state, state.pos);

      for (i = 0; i < scanned.length; i++) {
        delimiters.push({
          marker: ch,
          jump:   0,
          pos:    state.pos + i,
          end:    -1,
          open:   scanned.can_open,
          close:  scanned.can_close
        })

        lastDelim = delimiters[delimiters.length - 1];

        j = delimiters.length - 2 - i;

        while (j >= 0) {
          currDelim = delimiters[j];

          if (lastDelim.close && currDelim.open &&
              currDelim.marker === lastDelim.marker &&
              currDelim.end < 0) {

            lastDelim.jump = delimiters.length - 1 - j;
            lastDelim.open = false;
            currDelim.end  = lastDelim.pos;
            currDelim.jump = 0;
            break;
          }

          j -= currDelim.jump + 1;
        }

        if (lastDelim.jump === 0 && delimiters.length >= 2) {
          currDelim = delimiters[delimiters.length - 2];

          if (lastDelim.marker === currDelim.marker &&
              lastDelim.open === currDelim.open) {

            lastDelim.jump = currDelim.jump + 1;
          }
        }
      }

      cache.last = state.pos + scanned.length;
      state.pos = oldPos;
      return true;
    }

    state.md.inline.skipToken(state);

    if (state.pos >= max) {
      cache.last = state.pos;
      state.pos = oldPos;
      return false;
    }
  }
}


function getMatchingPair(state, start) {
  var delimiters, cache, 
      caches = state.emphasisCache;

  while (caches.length && caches[caches.length - 1].end < start) {
    caches.pop();
  }

  if (!caches.length) {
    caches.push({
      end:        state.posMax,
      last:       start,
      delimiters: []
    });
  }

  cache = caches[caches.length - 1];
  delimiters = cache.delimiters;

  while (delimiters.length && delimiters[0].pos < start) {
    delimiters.shift();
  }

  if (delimiters.length && delimiters[0].pos > start) {
    cache = {
      end:        state.posMax,
      last:       start,
      delimiters: []
    };

    delimiters = cache.delimiters;
    caches.push(cache);
  }

  while (!delimiters.length || delimiters[0].end < 0) {
    if (!calculateNextPair(state, cache)) {
      return -1;
    }
  }

  return delimiters[0].end;
}


module.exports = function emphasis(state, silent) {
  var startCount,
      count,
      found,
      oldCount,
      newCount,
      stack,
      res,
      token,
      pair,
      isStrong = false,
      max = state.posMax,
      start = state.pos,
      marker = state.src.charCodeAt(start);

  if (marker !== 0x5F/* _ */ && marker !== 0x2A /* * */) { return false; }
  if (silent) { return false; } // don't run any pairs in validation mode

  pair = getMatchingPair(state, start);

  // no matching pair
  if (pair < 0) { return false; }

  if (state.src.charCodeAt(start + 1) === marker) {
    isStrong = (getMatchingPair(state, start + 1) === pair - 1);
  }

  state.posMax = pair - (isStrong ? 1 : 0);
  state.pos = start + (isStrong ? 2 : 1);

  if (isStrong) {
    token        = state.push('strong_open', 'strong', 1);
    token.markup = String.fromCharCode(marker) + String.fromCharCode(marker);
  } else {
    token        = state.push('em_open', 'em', 1);
    token.markup = String.fromCharCode(marker);
  }

  state.md.inline.tokenize(state);

  if (isStrong) {
    token        = state.push('strong_close', 'strong', -1);
    token.markup = String.fromCharCode(marker) + String.fromCharCode(marker);
  } else {
    token        = state.push('em_close', 'em', -1);
    token.markup = String.fromCharCode(marker);
  }

  state.pos = pair + 1;
  state.posMax = max;
  return true;
};
