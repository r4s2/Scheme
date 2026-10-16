/**
 * Tournament page layout switches. Each one is a self-contained experiment:
 * set it to false to go back to the previous layout. Nothing else changes.
 */
export const LAYOUT = {
  /**
   * Bracket hub: the bracket tab carries the event's numbers (a slim strip
   * above the board, team strength and rank spread folded away below it)
   * instead of a separate Stats tab. false brings the Stats tab back.
   */
  bracketHub: true,
  /**
   * Host desk hub: the host's Match desk also holds announcements, tickets
   * and closing the event, instead of separate Announcements, Tickets and
   * Close tabs. Players keep their own Announcements and Tickets tabs either
   * way. false brings the separate host tabs back.
   */
  deskHub: true,
} as const;
