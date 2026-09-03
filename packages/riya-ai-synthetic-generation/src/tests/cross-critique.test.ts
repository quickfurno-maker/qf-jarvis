/**
 * The GPT ↔ Claude cross-critique lock (AS2, ADR-0143 §9).
 *
 * The rule this file exists to make real: a teacher may not be the sole approver of its own work, and
 * under strict policy at least one critic must come from a different model family. A critic sharing
 * the teacher's weights shares its blind spots — two of them are not two opinions, they are one
 * opinion with a second name.
 *
 * Neither family is named in production source. The labels below are inventory DATA, so the lock
 * outlives whichever two families happen to be current.
 */
import { describe, expect, it } from 'vitest';

import {
  RiyaSyntheticGenerationError,
  createRiyaSyntheticRoleAllocation,
  resolveRiyaSyntheticRoleAllocation,
} from '../index.js';
import { claudeTaughtAllocation, gptTaughtAllocation, inventory, policy } from './fixtures.js';

const INVENTORY = inventory();

describe('cross-family critique is enforced from the config inventory', () => {
  it('allows a GPT teacher judged by a Claude critic', () => {
    const families = resolveRiyaSyntheticRoleAllocation(gptTaughtAllocation(), INVENTORY, policy());

    expect(families.teacherModelFamilyRef).toBe('gpt');
    expect(families.criticModelFamilyRefs).toContain('claude');
  });

  it('allows a Claude teacher judged by a GPT critic', () => {
    const families = resolveRiyaSyntheticRoleAllocation(
      claudeTaughtAllocation(),
      INVENTORY,
      policy(),
    );

    expect(families.teacherModelFamilyRef).toBe('claude');
    expect(families.criticModelFamilyRefs).toContain('gpt');
  });

  it('refuses a GPT teacher judged only by GPT critics', () => {
    const sameFamily = gptTaughtAllocation({
      criticConfigRefs: ['cfg.critic.gpt', 'cfg.critic.gpt.two'],
    });

    expect(() => resolveRiyaSyntheticRoleAllocation(sameFamily, INVENTORY, policy())).toThrow(
      RiyaSyntheticGenerationError,
    );
  });

  it('refuses a Claude teacher judged only by Claude critics', () => {
    const sameFamily = claudeTaughtAllocation({
      criticConfigRefs: ['cfg.critic.claude', 'cfg.critic.claude.two'],
    });

    expect(() => resolveRiyaSyntheticRoleAllocation(sameFamily, INVENTORY, policy())).toThrow(
      RiyaSyntheticGenerationError,
    );
  });

  it('permits a same-family critic set only when the policy does not require cross-family', () => {
    // The switch is a POLICY, not a hard-coded family list. AS3 turns it on; a narrow diagnostic run
    // may legitimately turn it off, and that choice is visible in the policy rather than in source.
    const sameFamily = gptTaughtAllocation({
      criticConfigRefs: ['cfg.critic.gpt', 'cfg.critic.gpt.two'],
    });

    expect(() =>
      resolveRiyaSyntheticRoleAllocation(
        sameFamily,
        INVENTORY,
        policy({ requireCrossFamilyCritique: false }),
      ),
    ).not.toThrow();
  });

  it('refuses fewer critics than the policy requires', () => {
    const thin = gptTaughtAllocation({ criticConfigRefs: ['cfg.critic.claude'] });

    expect(() => resolveRiyaSyntheticRoleAllocation(thin, INVENTORY, policy())).toThrow(
      RiyaSyntheticGenerationError,
    );
  });
});

describe('a role may not be its own reviewer', () => {
  it('refuses a critic that is the teacher', () => {
    expect(() =>
      createRiyaSyntheticRoleAllocation({
        ...gptTaughtAllocation(),
        criticConfigRefs: ['cfg.teacher.gpt', 'cfg.critic.claude'],
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses a verifier that is the teacher', () => {
    // The self-approval failure one layer below the critic: the teacher confirming its own
    // structured annotations.
    expect(() =>
      createRiyaSyntheticRoleAllocation({
        ...gptTaughtAllocation(),
        annotationVerifierConfigRef: 'cfg.teacher.gpt',
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses a critic that is also the annotation verifier', () => {
    expect(() =>
      createRiyaSyntheticRoleAllocation({
        ...gptTaughtAllocation(),
        criticConfigRefs: ['cfg.verify.claude', 'cfg.critic.gpt'],
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses two critics sharing one configuration', () => {
    expect(() =>
      createRiyaSyntheticRoleAllocation({
        ...gptTaughtAllocation(),
        criticConfigRefs: ['cfg.critic.claude', 'cfg.critic.claude'],
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses a bundle identity that is also a role configuration', () => {
    expect(() =>
      createRiyaSyntheticRoleAllocation({
        ...gptTaughtAllocation(),
        generationRef: 'cfg.teacher.gpt',
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });
});

describe('the inventory is the authority on family, not the model', () => {
  it('refuses a configuration that is not permitted to serve its role', () => {
    // `cfg.planner` is a legal allocation SHAPE -- it collides with no other role -- so this gets
    // past the constructor and is caught where role capability actually lives: the inventory.
    const wrongRole = gptTaughtAllocation({ riyaTeacherConfigRef: 'cfg.planner' });

    expect(() => resolveRiyaSyntheticRoleAllocation(wrongRole, INVENTORY, policy())).toThrow(
      RiyaSyntheticGenerationError,
    );
  });

  it('refuses a configuration that is switched off for generation', () => {
    const disabled = inventory();
    const patched = {
      ...disabled,
      configs: disabled.configs.map((one) =>
        one.configRef === 'cfg.teacher.gpt' ? { ...one, activeForGeneration: false } : one,
      ),
    };

    expect(() =>
      resolveRiyaSyntheticRoleAllocation(gptTaughtAllocation(), patched, policy()),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses an unknown configuration reference', () => {
    const unknown = gptTaughtAllocation({ riyaTeacherConfigRef: 'cfg.does.not.exist' });

    expect(() => resolveRiyaSyntheticRoleAllocation(unknown, INVENTORY, policy())).toThrow(
      RiyaSyntheticGenerationError,
    );
  });
});
