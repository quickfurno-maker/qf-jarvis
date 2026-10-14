# VOX-16D: Jarvis gateway immutable image dependency repair

The VOX-16C staging-only gateway runtime imports `../../../contracts/vox/scopedAdvisoryReader.mjs` and `coreSubjectAuthorizer.mjs` at startup when enabled. The preexisting **signed gateway Dockerfile did not include `contracts/vox`**, so opt-in staging would fail at runtime even though TypeScript source CI passed. This PR adds identical complete contracts/vox copies to the builder and final **non-root** OCI runtime at `/app/contracts/vox`. No signing secrets copied, no privileged agent credentials, default-OFF preserved.

Validation certifies source-to-dist path, actual imports and a built OCI-image smoke (tests packaged files with non-root runtime). This is a deploy-blocking source bug fix only; a passed image test is not proof that live Core MFA/replay schema/private staging DNS exists. Do not enable ingress or deploy until controlled staged signed rollout passes.
