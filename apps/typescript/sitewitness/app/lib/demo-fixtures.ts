import { INTERVIEW_BRANCHES } from "./call-instructions.ts";
export const DEMO_SCENARIOS = ["bounded", "direct", "declined"] as const;
export function demoFixture(scenario: string) {
  const direct = scenario === "direct",
    declined = scenario === "declined";
  const dialogue: Array<[string, string]> = declined
    ? [
        [
          "bot",
          "I am an automated assistant. This demonstration call is transcribed for human review. May I ask about the property?",
        ],
        ["user", "No, I would rather speak to a person."],
        ["bot", "Of course. Thank you for your time."],
      ]
    : direct
      ? [
          [
            "bot",
            "I am an automated assistant. This demonstration call is transcribed for human review. May I ask about the property?",
          ],
          ["user", "Yes, you may."],
          ["bot", "What years did you personally know the property?"],
          ["user", "I managed it around 1992 to 1993."],
          [
            "bot",
            "Did you personally observe onsite cleaning, or is that something you heard?",
          ],
          [
            "user",
            "I personally did dry cleaning there during both of those years.",
          ],
          ["bot", "Where was the equipment you used?"],
          ["user", "The cleaning machine I used was in the back room."],
          [
            "bot",
            "What do you personally know about material deliveries or waste handling?",
          ],
          ["user", "I did not handle deliveries or waste, so I cannot say."],
          [
            "bot",
            "Do you know the operations outside those years, or another source we could ask?",
          ],
          ["user", "I do not know the other years or another person to ask."],
          ["bot", "Thank you for your time."],
        ]
      : [
          [
            "bot",
            "I am an automated assistant. This demonstration call is transcribed for human review. May I ask about the property?",
          ],
          ["user", "Yes, you may."],
          ["bot", "What years did you personally know the property?"],
          ["user", "I managed the building from 1991 through 1996."],
          [
            "bot",
            "What operations did you personally observe while the cleaners occupied it?",
          ],
          [
            "user",
            "I saw customers dropping off and picking up clothes from 1991 through 1994.",
          ],
          ["bot", "Which areas did you personally enter?"],
          [
            "user",
            "I mostly stayed in the front office and rarely entered the rear room.",
          ],
          [
            "bot",
            "Did you personally see cleaning equipment or handling activities?",
          ],
          [
            "user",
            "I never saw a machine or solvent handling in the areas I used.",
          ],
          [
            "bot",
            "What about the earlier years, or another person who could help?",
          ],
          [
            "user",
            "I do not know what happened before 1991. The prior manager, Carol, would know the rear area and earlier years.",
          ],
          ["bot", "Thank you for your time."],
        ];
  const fact = (text: string, quote: string, source_type = "first_hand") => ({
    fact: text,
    source_type,
    certainty: "uncertain",
    evidence_quote: quote,
  });
  const result = {
    schema_version: "evidence-v2",
    outcome: declined ? "human_follow_up" : "bounded",
    human_review_required: "yes",
    knowledge_period: {
      value: declined
        ? "Unknown"
        : direct
          ? "around 1992 to 1993"
          : "1991 through 1996",
      quote: declined ? "" : dialogue[3][1],
    },
    statements: declined
      ? []
      : direct
        ? [
            fact(
              "The respondent managed the property around 1992–1993.",
              dialogue[3][1],
            ),
            fact(
              "The respondent personally performed onsite dry cleaning during both years.",
              dialogue[5][1],
            ),
            fact(
              "The respondent used a machine in the back room.",
              dialogue[7][1],
            ),
          ]
        : [
            fact(
              "The respondent managed the property from 1991 through 1996.",
              dialogue[3][1],
            ),
            fact(
              "The respondent observed drop-off and pickup from 1991 through 1994.",
              dialogue[5][1],
            ),
            fact(
              "The respondent rarely entered the rear room.",
              dialogue[7][1],
              "knowledge_limitation",
            ),
          ],
    limitations: declined
      ? []
      : [
          {
            text: direct
              ? "The respondent did not handle deliveries or waste."
              : "The respondent's access was mostly limited to the front office.",
            quote: dialogue[direct ? 9 : 7][1],
          },
        ],
    unknowns: declined
      ? []
      : [
          {
            text: direct
              ? "Operations outside around 1992–1993 remain outside this respondent's knowledge."
              : "The respondent does not know operations before 1991.",
            quote: dialogue[11][1],
          },
        ],
    new_leads:
      !direct && !declined
        ? [
            {
              name: "Carol",
              reason:
                "Prior manager who may know the rear area and earlier years",
              quote: dialogue[11][1],
            },
          ]
        : [],
    branch_results: INTERVIEW_BRANCHES.map((branch, i) => ({
      id: branch.id,
      status: declined
        ? "declined"
        : direct && (i === 3 || i === 5)
          ? "unknown"
          : "answered",
      evidence_quote: declined
        ? dialogue[1][1]
        : dialogue[[3, 5, direct ? 7 : 9, 9, 11, 11][i]][1],
    })),
  };
  return {
    result,
    raw: {
      synthetic: true,
      recipients: [
        {
          attempts: [
            {
              transcript_turns: dialogue.map(([speaker, text], index) => ({
                speaker,
                text,
                offset_seconds: index * 5,
              })),
            },
          ],
        },
      ],
    },
  };
}
