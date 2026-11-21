import { describe, it, expect } from "vitest";
import { looksHallucinated } from "./transcribe.js";
import type { TranscriptSegment } from "./transcribe.js";

/**
 * Fixtures are the real thing: the left column is seven segments Whisper
 * returned for 2:10 of a no-commentary World Cup final, the right is real
 * broadcast commentary from a France-Belgium package.
 */
describe("looksHallucinated", () => {
  const seg = (start: number, text: string): TranscriptSegment => ({ start, end: start + 4, text });

  const invented = [
    seg(12, "193.Francisco Ramos heads the ball to Kovacic, who is on the attack."),
    seg(13, "194.Ramos dribbles to Kovacic, who is on the attack."),
    seg(57, "195.Ramos dribbles to Kovacic, who is on the attack."),
    seg(87, "200.Ramos attack Kovacic, who is on the attack."),
    seg(100, "200.Ramos dribbles to Kovacic, who is on the attack."),
    seg(101, "200.Ramos dribbles to Kovacic, who is on the attack."),
    seg(118, "200.Ramos attack Kovacic, who is on the attack."),
  ];

  const real = [
    seg(270, "Just got underneath the header"),
    seg(282, "Couple of international goals already"),
    seg(313, "Can they find a goal though? Here's Ousmane Dembele in full flight"),
    seg(331, "Plays from the start and gives Belgium the lead"),
    seg(505, "Gave the goalkeeper the eyes. It's a super finish"),
    seg(560, "Quick silver feet fabulous finish France have their equalizing goal"),
    seg(598, "Two goals in three minutes and France lead at the Stade de France"),
  ];

  it("catches a looping invention", () => {
    expect(looksHallucinated(invented)).toBe(true);
  });

  it("leaves real commentary alone", () => {
    expect(looksHallucinated(real)).toBe(false);
  });

  it("does not judge a transcript too short to judge", () => {
    expect(looksHallucinated(invented.slice(0, 3))).toBe(false);
    expect(looksHallucinated([])).toBe(false);
  });

  it("needs BOTH signals, so repeated short lines in real speech survive", () => {
    // A chant or a countdown repeats lines without the vocabulary collapsing.
    const chant = [
      seg(0, "Here we go"),
      seg(4, "Here we go"),
      seg(8, "Here we go"),
      seg(12, "And the referee blows his whistle to start the second half"),
      seg(16, "Mbappe collects possession just inside the Belgian half"),
      seg(20, "He drives forward looking for an opening on the left"),
    ];
    expect(looksHallucinated(chant)).toBe(false);
  });
});
