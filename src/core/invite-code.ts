/**
 * 邀请码的字母表。
 *
 * 不能用 nanoid 的默认字母表再 toUpperCase()：默认表是 A-Za-z0-9_-，
 * 大写之后 a 和 A 撞成同一个字符，**白白丢掉一半的熵**，
 * 而且会出现 `-` 和 `_` - 6 位码是要靠嘴说、靠手打的，
 * 这两个符号在电话里根本讲不清楚。
 *
 * 这里去掉了所有形近字符：I / L / O / 0 / 1。
 * 31 个字符 6 位约 8.9 亿种，够用，code 上还有唯一索引兜底。
 */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 6;

import { customAlphabet } from "nanoid";

const generate = customAlphabet(INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH);

export function inviteCode(): string {
  return generate();
}
