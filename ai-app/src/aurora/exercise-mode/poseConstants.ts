/**
 * poseConstants.ts — MediaPipe Pose (33-landmark) topology.
 *
 * Index reference (the ones we use for form checks):
 *   0 nose
 *   11 L-shoulder   12 R-shoulder
 *   13 L-elbow      14 R-elbow
 *   15 L-wrist      16 R-wrist
 *   23 L-hip        24 R-hip
 *   25 L-knee       26 R-knee
 *   27 L-ankle      28 R-ankle
 *   29 L-heel       30 R-heel
 *   31 L-foot-index 32 R-foot-index
 */
export const POSE = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
} as const;

/**
 * Bone adjacency for drawing the skeleton overlay — a curated subset of the
 * full MediaPipe graph (face mesh points dropped; they add clutter and the
 * coach doesn't use them). Each pair is [fromIndex, toIndex].
 */
export const POSE_BONES: ReadonlyArray<readonly [number, number]> = [
  // shoulders / torso box
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  // left arm
  [11, 13],
  [13, 15],
  // right arm
  [12, 14],
  [14, 16],
  // left leg
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  // right leg
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

/** The torso/limb landmarks we draw as joints (skip the dense face points). */
export const POSE_JOINTS: readonly number[] = [
  0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];
