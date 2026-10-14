export declare function createScopedVoxAdvisoryReader(options: {
  pool: { query: (statement: string, parameters?: unknown[]) => Promise<unknown> };
  secret: string;
  authorizeCoreSubject: (
    request: Readonly<{
      requesterBearer: string;
      subjectType: string;
      subjectId: string;
      agent: string;
      channel: string;
      revision: number;
    }>,
  ) => Promise<unknown>;
  clock?: () => number;
}): Readonly<{
  verifyForStaff(args: { agentViewToken: string; requesterBearer: string }): Promise<unknown>;
}>;
