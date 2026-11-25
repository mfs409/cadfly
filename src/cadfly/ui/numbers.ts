/**
 * How numbers are written in the interface: sizes and counts for people to
 * read.
 */

/**
 * A number to one decimal place, with its thousands separated: 3200.04 is
 * "3,200".
 *
 * @param v The number.
 */
export function oneDecimal(v: number): string {
  return (Math.round(v * 10) / 10).toLocaleString("en-US");
}

/**
 * A count with its thousands separated: 3200 is "3,200".
 *
 * @param n The count.
 */
export function withCommas(n: number): string {
  return n.toLocaleString("en-US");
}
