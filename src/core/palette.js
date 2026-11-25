import { hex } from './color.js';

const h = (arr) => arr.map(hex);

// Index 0 is always the darkest (outline) tone.
export const PAL = {
  oakLeaf: h(['#12291c', '#1c4424', '#2a632c', '#3c8334', '#59a13c', '#86c249', '#c2e06a']),
  bushLeaf: h(['#18301f', '#244d29', '#376d30', '#548f38', '#7bb043', '#aad159', '#dbe987']),
  pineLeaf: h(['#0b2023', '#123532', '#1b4c41', '#27674f', '#3c845b', '#5fa168', '#97c47b']),
  // All bark tones satisfy the article's "wood" test: hue 5..40°, S > 0.22, luminance < 125.
  oakBark: h(['#2e1c14', '#4a2e1e', '#6b4529', '#8a5e36', '#9c6d40']),
  pineBark: h(['#3a2219', '#5a3524', '#7c4c31', '#96633e', '#a06d44']),
  berry: h(['#d64570', '#f2d65a', '#ef8fb5']),

  sky: h(['#2a3c78', '#34539a', '#4b72b5', '#6b94cb', '#93b6db', '#bdd3e2', '#e9e2c4', '#f6dfaa']),
  sun: hex('#fff6d6'),
  sunHalo: h(['#fcefc0', '#f8e3a6']),
  cloud: h(['#7f89b1', '#a2a9c8', '#cbd0e0', '#eeeef0', '#fffaf0']),
  mountFar: h(['#7d93c2', '#93a8cf', '#a9bcdb']),
  mountNear: h(['#5e78a8', '#6f8bb6', '#86a0c4']),
  snow: h(['#c7d4e8', '#eef3fa']),
  hill: h(['#4c7884', '#5a8984', '#6a9a83']),
  forest: h(['#3a6470', '#467570', '#55866f']),
  grass: h(['#244a25', '#2f5f2b', '#3d7631', '#4f8d38', '#69a641', '#8cbd52', '#b2d36a']),
  dirt: h(['#6e5236', '#8b6a45', '#a8845a', '#c4a273']),
  water: h(['#2c5a8a', '#3a74a6', '#5c97c6', '#8cbfe0', '#d4eef7']),
  rock: h(['#3f4252', '#5b5e70', '#7c7f90', '#a3a5b2']),
  flower: h(['#e9544f', '#f3cb4a', '#f4efe4', '#9b74d6', '#f08fb2', '#6fb8f0']),
  shadowTint: hex('#1a2742'),
  bird: hex('#2b2c3e'),
};
