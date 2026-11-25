/**
 * Writes the picture the README shows, `tests/badges/tests.svg`, from the
 * results of `npm run coverage`: how many tests passed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** A flat two-part badge: a grey label and a coloured value. */
function badge(label: string, value: string, color: string): string {
  const width = (text: string) => text.length * 7 + 12;
  const l = width(label);
  const v = width(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l + v}" height="20" role="img" aria-label="${label}: ${value}">
  <rect width="${l}" height="20" fill="#555"/>
  <rect x="${l}" width="${v}" height="20" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,Geneva,sans-serif" font-size="11" text-anchor="middle">
    <text x="${l / 2}" y="14">${label}</text>
    <text x="${l + v / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}

const results = JSON.parse(readFileSync("coverage/results.json", "utf8")) as { numPassedTests: number; numTotalTests: number };
const allPassed = results.numPassedTests === results.numTotalTests;

mkdirSync("tests/badges", { recursive: true });
writeFileSync(
  "tests/badges/tests.svg",
  badge("tests", `${results.numPassedTests}/${results.numTotalTests} passing`, allPassed ? "#3a3" : "#c43"),
);
console.log(`tests ${results.numPassedTests}/${results.numTotalTests}`);
