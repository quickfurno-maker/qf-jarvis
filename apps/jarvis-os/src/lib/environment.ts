/**
 * Environment identity (JOS-01B).
 *
 * JOS-01A labelled every screen `STAGING · DEMO DATA`, which was honest then and is wrong now:
 * the default surface no longer renders demo data, and nothing is deployed to staging. A label
 * that overstates where the surface is running is the same class of defect as a chart that
 * overstates what it observed.
 *
 * There is no `process.env` read here and there will not be one. This build is not deployed, so
 * an environment variable would only let a wrong label be configured in more places.
 */
export const ENVIRONMENT_LABEL = 'LOCAL · NOT DEPLOYED';

/** The label the demo fixture carries, so a fixture screenshot can never be mistaken for the default. */
export const DEMO_ENVIRONMENT_LABEL = 'DEMO FIXTURE · NOT OPERATIONAL DATA';
