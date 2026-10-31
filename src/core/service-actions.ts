/** Contextual host actions, shared by every provider and the player UI. */
export type ServiceAction = {
  id: string;
  label: string;
  /** Host-owned progress in [0,1]; the player never starts the host's timer. */
  progress?: number;
};

export interface ServiceActionSource {
  read(): ServiceAction[];
  /** Availability changes, including a visible-document fallback <=1 Hz; owned cleanup. */
  subscribe?(onChange: () => void): () => void;
  /** Cheap live native progress. Null invalidates the saved action; undefined has no progress. */
  readProgress?(id: string): number | null | undefined;
  /** Revalidate availability and identity before performing the interaction. */
  activate(id: string): boolean;
  /**
   * The host offers its own next step after the end (a next episode, an up-next or end card, a countdown), so the
   * ended curtain yields and its Replay never competes with it. Read on the end and on changes while ended: a finale
   * without such a step gets the curtain as everywhere else.
   */
  hostEndsPlayback?(): boolean;
}
