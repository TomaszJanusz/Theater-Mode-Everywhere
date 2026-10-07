/** Contextual host actions, shared by every provider and the player UI. */
export type ServiceAction = {
  id: string;
  label: string;
  /** Host-owned progress in [0,1]; the player never starts the host's timer. */
  progress?: number;
};

export interface ServiceActionSource {
  read(): ServiceAction[];
  /** Revalidate availability and identity before performing the interaction. */
  activate(id: string): boolean;
}
