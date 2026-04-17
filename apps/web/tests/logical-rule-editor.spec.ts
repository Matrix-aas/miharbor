// LogicalRuleEditor — component tests (Task 40 AC).
//
// Scope:
//   * Renders the supplied tree (op badges + children + condition rows).
//   * Add-condition appends a SimpleRule child.
//   * Add-AND / Add-OR / Add-NOT appends a nested LogicalRule.
//   * Up/Down reorders children within a group.
//   * Remove removes a child.
//   * Save emits a LogicalRule with target filled in.
//   * Save is disabled while a SimpleRule has an invalid value.
//   * Max-depth 5 — the nth "Add AND" inside nested groups disables at level 5.
//   * Round-trip: parse → edit via editor helpers → serialize → parse yields
//     the edited tree (exercises the exact DOM event path).
//   * RuleRow for a logical rule emits `edit` when pencil clicked (no longer
//     disabled).

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { LogicalRule, Rule, SimpleRule } from 'miharbor-shared'
import { parseRule, serializeRule } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import LogicalRuleTreeBody from '../src/components/services/LogicalRuleTreeBody.vue'
import LogicalRuleNode from '../src/components/services/LogicalRuleNode.vue'
import RuleRow from '../src/components/services/RuleRow.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

function mountEditor(initial?: LogicalRule, target = 'Streaming') {
  return mount(LogicalRuleTreeBody, {
    props: { initial, target },
    global: { plugins: [makeI18n()] },
  })
}

function makeAndTree(): LogicalRule {
  return {
    kind: 'logical',
    op: 'AND',
    children: [
      { kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'example.com', target: '' },
      { kind: 'simple', type: 'NETWORK', value: 'tcp', target: '' },
    ],
    target: 'Streaming',
  }
}

function makeNestedTree(): LogicalRule {
  return {
    kind: 'logical',
    op: 'AND',
    children: [
      { kind: 'simple', type: 'GEOSITE', value: 'google', target: '' },
      {
        kind: 'logical',
        op: 'NOT',
        children: [{ kind: 'simple', type: 'GEOIP', value: 'CN', target: '' }],
        target: '',
      },
    ],
    target: 'Proxy',
  }
}

describe('LogicalRuleEditor — rendering', () => {
  it('renders the operator badge and children for the supplied tree', () => {
    const w = mountEditor(makeAndTree())
    expect(w.text()).toContain('AND')
    const values = w
      .findAll('input.h-9.font-mono')
      .map((i) => (i.element as HTMLInputElement).value)
    expect(values).toContain('example.com')
    expect(values).toContain('tcp')
    w.unmount()
  })

  it('renders nested logical groups recursively', () => {
    const w = mountEditor(makeNestedTree())
    // Both AND and NOT badges present.
    expect(w.text()).toContain('AND')
    expect(w.text()).toContain('NOT')
    // The inner GEOIP condition is visible — its value sits in an input.
    const values = w
      .findAll('input.h-9.font-mono')
      .map((i) => (i.element as HTMLInputElement).value)
    expect(values).toContain('CN')
    // Target input value.
    const targetInput = w.find('[data-testid="tree-target-input"]')
    expect((targetInput.element as HTMLInputElement).value).toBe('Proxy')
    w.unmount()
  })

  it('seeds a default AND + empty condition when no initial tree', () => {
    const w = mountEditor(undefined, 'Streaming')
    expect(w.text()).toContain('AND')
    // Target from prop prefilled.
    const targetInput = w.find('[data-testid="tree-target-input"]')
    expect((targetInput.element as HTMLInputElement).value).toBe('Streaming')
    w.unmount()
  })
})

describe('LogicalRuleEditor — interactions', () => {
  it('adds a new condition when "Add condition" clicked', async () => {
    const w = mountEditor(makeAndTree())
    // Find the root group's Add-condition button (first one in DOM order).
    const btn = w.findAll('button').find((b) => b.text().includes('Add condition'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    // Now there should be 3 simple-rule rows in the tree.
    const simpleNodes = w.findAll('[data-testid="simple-rule-node"]')
    expect(simpleNodes.length).toBe(3)
    w.unmount()
  })

  it('adds a nested AND group when "Add AND group" clicked', async () => {
    const w = mountEditor(makeAndTree())
    const btn = w.findAll('button').find((b) => b.text().includes('Add AND group'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    // Now there are 2 logical groups in the tree (root + the new nested AND).
    const logicalNodes = w.findAll('[data-testid="logical-rule-node"]')
    expect(logicalNodes.length).toBe(2)
    w.unmount()
  })

  it('removes a child when trash icon clicked', async () => {
    const w = mountEditor(makeAndTree())
    // Each simple-rule row has a "Remove node" button. Click the first.
    const removeBtns = w
      .findAll('button')
      .filter((b) => b.attributes('aria-label') === 'Remove node')
    expect(removeBtns.length).toBeGreaterThan(0)
    await removeBtns[0]!.trigger('click')
    const simpleNodes = w.findAll('[data-testid="simple-rule-node"]')
    expect(simpleNodes.length).toBe(1)
    w.unmount()
  })

  it('moves a child down when arrow-down clicked', async () => {
    const tree = makeAndTree()
    const w = mountEditor(tree)
    const downBtns = w.findAll('button').filter((b) => b.attributes('aria-label') === 'Move down')
    // Only the first child can move down (second has no room).
    expect(downBtns.length).toBeGreaterThanOrEqual(1)
    await downBtns[0]!.trigger('click')
    // Inputs now: [NETWORK tcp] comes first.
    const inputs = w.findAll('input.h-9.font-mono')
    // First value input should be "tcp".
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('tcp')
    w.unmount()
  })

  it('disables save while a child has an invalid value', async () => {
    const tree: LogicalRule = {
      kind: 'logical',
      op: 'AND',
      children: [{ kind: 'simple', type: 'DOMAIN-SUFFIX', value: '', target: '' }],
      target: 'Streaming',
    }
    const w = mountEditor(tree)
    const save = w.find('[data-testid="tree-save-btn"]')
    expect((save.element as HTMLButtonElement).disabled).toBe(true)
    // Fill the value.
    const valueInput = w.findAll('input.h-9.font-mono')[0]
    await valueInput!.setValue('example.com')
    expect((save.element as HTMLButtonElement).disabled).toBe(false)
    w.unmount()
  })

  it('disables save when target is empty', async () => {
    const w = mountEditor(makeAndTree())
    const save = w.find('[data-testid="tree-save-btn"]')
    expect((save.element as HTMLButtonElement).disabled).toBe(false)
    const targetInput = w.find('[data-testid="tree-target-input"]')
    await targetInput.setValue('')
    expect((save.element as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('emits save with the edited tree', async () => {
    const w = mountEditor(makeAndTree())
    const form = w.find('form')
    await form.trigger('submit.prevent')
    const emitted = w.emitted('save') as unknown as LogicalRule[][] | undefined
    expect(emitted).toBeTruthy()
    const rule = emitted?.[0]?.[0]
    expect(rule?.kind).toBe('logical')
    expect(rule?.op).toBe('AND')
    expect(rule?.target).toBe('Streaming')
    expect(rule?.children).toHaveLength(2)
    // Children must carry target='' per mihomo serialization rules.
    expect((rule?.children[0] as SimpleRule).target).toBe('')
    w.unmount()
  })

  it('round-trip: parse -> edit -> serialize -> parse yields edited tree', async () => {
    // Real-world input string.
    const raw = 'AND,((DOMAIN-SUFFIX,example.com),(NETWORK,tcp)),Streaming'
    const parsed = parseRule(raw) as LogicalRule
    const w = mountEditor(parsed)
    // Change the value of the first condition.
    const valueInput = w.findAll('input.h-9.font-mono')[0]
    await valueInput!.setValue('edited.com')
    // Save.
    const form = w.find('form')
    await form.trigger('submit.prevent')
    const emitted = w.emitted('save') as unknown as LogicalRule[][] | undefined
    const edited = emitted?.[0]?.[0]
    expect(edited).toBeTruthy()
    // Serialize the emitted tree and re-parse — the result must match what
    // we emitted structurally.
    const reParsed = parseRule(serializeRule(edited as Rule))
    expect(reParsed).toEqual(edited as Rule)
    // And the round-trip output preserves the edited value.
    expect((reParsed as LogicalRule).children[0]).toMatchObject({
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'edited.com',
    })
    w.unmount()
  })
})

describe('LogicalRuleEditor — depth limit', () => {
  it('disables "Add AND/OR/NOT group" at max depth', async () => {
    // Build a nested tree where the innermost group sits at depth 5. The
    // top-level node is depth 0 — each `wrap()` step pushes the original
    // tree one level deeper. Starting with a depth-0 group and wrapping 5
    // times yields a tree whose innermost group is at depth 5 (== MAX_DEPTH
    // used by LogicalRuleTreeBody).
    const leaf: Rule = { kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'a.com', target: '' }
    let innerGroup: LogicalRule = {
      kind: 'logical',
      op: 'AND',
      children: [leaf],
      target: '',
    }
    for (let wrapCount = 0; wrapCount < 5; wrapCount++) {
      innerGroup = {
        kind: 'logical',
        op: 'AND',
        children: [innerGroup],
        target: wrapCount === 4 ? 'Streaming' : '',
      }
    }
    const w = mountEditor(innerGroup)
    // The innermost group is at depth 5 — a "max depth" notice must appear.
    const maxDepthNotices = w.findAll('[data-testid="max-depth-notice"]')
    expect(maxDepthNotices.length).toBeGreaterThanOrEqual(1)
    // At least one "Add AND group" button must be disabled.
    const andBtns = w.findAll('button').filter((b) => b.text().includes('Add AND group'))
    const someDisabled = andBtns.some((b) => (b.element as HTMLButtonElement).disabled)
    expect(someDisabled).toBe(true)
    w.unmount()
  })
})

describe('LogicalRuleEditor — NOT invariant', () => {
  it('prevents adding a second child to a NOT group', async () => {
    const tree: LogicalRule = {
      kind: 'logical',
      op: 'NOT',
      children: [{ kind: 'simple', type: 'GEOIP', value: 'CN', target: '' }],
      target: 'Proxy',
    }
    const w = mountEditor(tree)
    // Find the NOT group's Add-condition button — should be disabled.
    const addCondBtn = w.findAll('button').find((b) => b.text().includes('Add condition'))
    expect((addCondBtn!.element as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('flags an empty NOT group as invalid', async () => {
    const tree: LogicalRule = {
      kind: 'logical',
      op: 'NOT',
      children: [],
      target: 'Proxy',
    }
    const w = mountEditor(tree)
    const save = w.find('[data-testid="tree-save-btn"]')
    expect((save.element as HTMLButtonElement).disabled).toBe(true)
    // Surfaced as inline alert on the group.
    expect(w.text()).toContain('NOT requires exactly one child')
    w.unmount()
  })
})

describe('RuleRow — logical rule edit handoff', () => {
  it('pencil button is enabled and emits edit when clicked', async () => {
    const logical: Rule = {
      kind: 'logical',
      op: 'AND',
      children: [{ kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'example.com', target: '' }],
      target: 'Streaming',
    }
    const w = mount(RuleRow, {
      props: { rule: logical, index: 7 },
      global: { plugins: [makeI18n()] },
    })
    const editBtn = w.find('[data-testid="logical-edit-btn"]')
    expect(editBtn.exists()).toBe(true)
    expect((editBtn.element as HTMLButtonElement).disabled).toBe(false)
    await editBtn.trigger('click')
    const emitted = w.emitted('edit') as unknown as number[][] | undefined
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe(7)
  })
})

describe('LogicalRuleNode — group aria-label', () => {
  it('emits a descriptive aria-label on the group wrapper', () => {
    const rule: LogicalRule = {
      kind: 'logical',
      op: 'OR',
      children: [
        { kind: 'simple', type: 'GEOSITE', value: 'google', target: '' },
        { kind: 'simple', type: 'GEOSITE', value: 'youtube', target: '' },
      ],
      target: '',
    }
    const w = mount(LogicalRuleNode, {
      props: {
        rule,
        depth: 0,
        maxDepth: 5,
        canRemove: false,
        siblingIndex: 0,
        siblingCount: 1,
      },
      global: { plugins: [makeI18n()] },
    })
    const group = w.find('[data-testid="logical-rule-node"]')
    const aria = group.attributes('aria-label') ?? ''
    // Expect a shape like "OR group, 2 children"
    expect(aria).toMatch(/OR group.*2 children/)
  })
})
