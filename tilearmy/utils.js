function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function newId(len = 9) {
  return Math.random().toString(36).slice(2, 2 + len);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

module.exports = { rand, newId, clamp };
