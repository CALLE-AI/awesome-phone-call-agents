import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_YEARS,
  coverageQuoteCitation,
  defaultCoverageQuote,
  yearsInText,
} from "../app/lib/case-coverage.ts";
import { extractTranscript } from "../app/lib/evidence.ts";

test("the recorded ranges make every intervening research year available", () => {
  for (const quote of [
    "I operated the shop from 1987 to through 1994.",
    "I operated the shop from 1987 all the way to 1994.",
  ])
    assert.deepEqual(yearsInText(quote), RESEARCH_YEARS, quote);
});

test("continuous ranges support normal, redundant, and punctuated connectors", () => {
  for (const connector of [
    "to",
    "through",
    "until",
    "-",
    "–",
    "—",
    "to through",
    "through to",
    "to, through",
    "all the way to",
    "all the way through",
    "all the way until",
    "all the way up to",
    "up to",
    "up until",
    "right up until",
    "ALL THE WAY TO",
    "all\nthe way to",
  ]) {
    assert.deepEqual(
      yearsInText(`1987 ${connector} 1994`),
      RESEARCH_YEARS,
      connector,
    );
  }
});

test("spoken and mixed written years preserve a continuous range", () => {
  for (const sentence of [
    "I operated the shop from nineteen eighty-seven to through nineteen ninety-four.",
    "From NINETEEN EIGHTY SEVEN through 1994.",
    "1987 to nineteen ninety four.",
    "From nineteen eighty-seven all the way to nineteen ninety-four.",
  ])
    assert.deepEqual(yearsInText(sentence), RESEARCH_YEARS);
  assert.deepEqual(
    yearsInText("nineteen ninety through nineteen ninety-two"),
    [1990, 1991, 1992],
  );
});

test("apostrophe years in the actual Morgan answer retain the exact supported period", () => {
  for (const quote of [
    "Yes. I was there from about '92 to '93.",
    "Yes. I was there from about ’92 to ’93.",
    "I was there from 1992 to '93.",
  ]) assert.deepEqual(yearsInText(quote), [1992, 1993], quote);
  assert.deepEqual(yearsInText("From '87 all the way to '94."), RESEARCH_YEARS);
  assert.deepEqual(yearsInText("'92 and '94"), [1992, 1994]);
  assert.deepEqual(yearsInText("'94 to '92"), [1992, 1994]);
  assert.deepEqual(yearsInText("'95 through '99"), []);
  assert.deepEqual(yearsInText("92 to 93 people"), []);
});

test("discrete, reversed, and ambiguous dates never fill intervening years", () => {
  for (const sentence of [
    "1992 and 1994",
    "1992 or 1994",
    "1994 through 1992",
    "1992 to, I think, through 1994",
    "1992, but not all the way to 1994",
    "1992 all the way to an unknown date before 1994",
    "1992 all the way to, I think, 1994",
    "1994 all the way to 1992",
  ])
    assert.deepEqual(yearsInText(sentence), [1992, 1994], sentence);
  assert.deepEqual(yearsInText("1992, 1994 and 1987"), [1987, 1992, 1994]);
  assert.deepEqual(
    yearsInText("1987 through 1989 and 1994"),
    [1987, 1989, 1994],
  );
});

test("ranges are bounded to the research years and absent dates do not create coverage", () => {
  assert.deepEqual(yearsInText("1985 to through 1996"), RESEARCH_YEARS);
  assert.deepEqual(yearsInText("1980 through 1986"), []);
  assert.deepEqual(yearsInText("1995 through 2000"), []);
  assert.deepEqual(yearsInText("around 1992"), [1992]);
  assert.deepEqual(yearsInText("1987 through an unknown end date"), [1987]);
  assert.deepEqual(yearsInText("No dates were supplied."), []);
  assert.deepEqual(yearsInText("nineteen ninety-five"), []);
  assert.deepEqual(
    yearsInText("nineteen ninety nine to nineteen ninety-four"),
    [1994],
  );
});

test("Carol's original answer supplies all eight year suggestions when the extracted quote combines answers", () => {
  const actualQuote = "I worked there from 1987 to '94 in the back room doing most of the dry cleaning.";
  const providerQuote = "I worked there from 1987 to 1994 in the back room doing most of the dry cleaning. / I was there for all of 1994. And then after that, I don't know. Know.";
  const turns = extractTranscript({recipients:[{attempts:[{transcript_turns:[
    {speaker:"bot",text:"Did you work there from 1987 through 1994?"},
    {speaker:"user",text:actualQuote},
    {speaker:"user",text:"I was there for all of 1994. And then after that, I don't know. Know."},
  ]}]}]}, 42);
  assert.equal(coverageQuoteCitation(providerQuote, turns).status, "unmatched");
  const suggested = defaultCoverageQuote(providerQuote, turns);
  assert.deepEqual(suggested, {quote:actualQuote,sourceTurnId:turns[1].id});
  assert.deepEqual(yearsInText(suggested.quote), RESEARCH_YEARS);
  assert.equal(coverageQuoteCitation(suggested.quote, turns, suggested.sourceTurnId).status, "matched");
  assert.equal(turns[1].text, actualQuote, "source selection must preserve the original recorded words");
});

test("a matching provider quote stays selected and date suggestions never fall back to an agent's words", () => {
  const turns = extractTranscript({recipients:[{attempts:[{transcript_turns:[
    {speaker:"bot",text:"Tell me about 1987 through 1994."},
    {speaker:"user",text:"I worked there in 1987."},
    {speaker:"user",text:"I managed it in 1992 and 1993."},
  ]}]}]}, 43);
  assert.deepEqual(defaultCoverageQuote(turns[2].text, turns), {quote:turns[2].text,sourceTurnId:turns[2].id});
  assert.equal(defaultCoverageQuote("An invented extracted answer.", turns).quote, turns[1].text);
  assert.equal(defaultCoverageQuote("", turns.filter(turn => turn.speaker === "assistant")).quote, "");
  assert.equal(defaultCoverageQuote("", []).quote, "");
});

test("a reviewer can identify one repeated respondent answer without approving an agent turn", () => {
  const quote = "I worked there in 1992 and 1993.";
  const turns = extractTranscript({recipients:[{attempts:[{transcript_turns:[
    {speaker:"user",text:quote},
    {speaker:"bot",text:quote},
    {speaker:"user",text:quote},
  ]}]}]}, 44);
  assert.equal(coverageQuoteCitation(quote, turns).status, "ambiguous");
  assert.deepEqual(coverageQuoteCitation(quote, turns, turns[2].id), {status:"matched",turnIds:[turns[2].id]});
  assert.notEqual(coverageQuoteCitation(quote, turns, turns[1].id).status, "matched");
  assert.notEqual(coverageQuoteCitation(quote, turns, "invented-turn").status, "matched");
});

test("unfamiliar tenure wording remains a suggestion instead of silently inferring coverage", () => {
  assert.deepEqual(yearsInText("I started in 1987 and stayed until the end of 1994."), [1987, 1994]);
  assert.deepEqual(yearsInText("I was there continuously for the entire period you just asked about."), []);
});
