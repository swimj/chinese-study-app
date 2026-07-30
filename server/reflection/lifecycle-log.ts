export type ReflectionLifecycleEvent =
  | {
      event: 'reflection.summary_recorded';
      sessionId: string;
      completedReviewActionCount: number;
      failedReviewActionCount: number;
    }
  | {
      event: 'reflection.generation_requested';
      sessionId: string;
    }
  | {
      event: 'reflection.provider_started';
      sessionId: string;
      evidenceItemCount: number;
    }
  | {
      event: 'reflection.generation_succeeded';
      sessionId: string;
      artifactId: string;
      proposalCount: number;
      status: 'created' | 'existing';
      elapsedMs: number;
    }
  | {
      event: 'reflection.generation_failed';
      sessionId: string;
      failure: 'invalid_evidence' | 'provider' | 'internal';
      code: string | null;
      clientRequestId: string | null;
      elapsedMs: number;
    };

export type ReflectionLifecycleLogger = {
  emit(event: ReflectionLifecycleEvent): void;
};

/**
 * A deliberately small local observability seam. Events are newline-delimited
 * JSON on stdout, with only correlation identifiers and lifecycle metadata.
 * Prompts, responses, learner answers, and credentials never belong here.
 */
export function createStdoutReflectionLifecycleLogger(): ReflectionLifecycleLogger {
  return {
    emit(event) {
      console.info(JSON.stringify({ at: new Date().toISOString(), ...event }));
    },
  };
}
