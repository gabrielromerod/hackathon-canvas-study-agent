import { activeThread } from '../chat/view.js';
import { scopeChoices, scopeKey, findScope } from '../chat/scope.js';
import { resolveCurrentScope } from '../canvas/current-context.js';
import { node } from './dom.js';

export function createScopePicker(root, onSelect) {
  const chip = root.querySelector('#context-chip');
  const picker = root.querySelector('#scope-picker');
  const list = root.querySelector('#scope-options');
  let state,
    identity = '',
    menuKey = '';
  const close = (focus = false) => {
    picker.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    if (focus) chip.focus();
  };
  function renderOptions(choices, scope) {
    const expanded = new Set(
      [...list.querySelectorAll('details[open]')].map((el) => el.dataset.scopeKey),
    );
    list.replaceChildren();
    const selected = scopeKey(scope);
    const button = (choice, label = choice.label) => {
      const el = node(root, 'button', null, 'scope-option');
      el.type = 'button';
      el.dataset.scopeKind = choice.scope.kind;
      el.setAttribute('aria-pressed', String(scopeKey(choice.scope) === selected));
      el.append(node(root, 'span', label), node(root, 'small', choice.scope.kind));
      el.addEventListener('click', () => onSelect(choice.scope));
      return el;
    };
    const branch = (choice) => {
      if (['page', 'current'].includes(choice.scope.kind)) return button(choice);
      const details = node(root, 'details', null, 'scope-group');
      details.dataset.scopeKey = scopeKey(choice.scope);
      details.open =
        expanded.has(details.dataset.scopeKey) ||
        (String(choice.scope.moduleId) === String(scope.moduleId) &&
          (choice.scope.kind === 'module' ||
            choice.scope.sectionId === scope.sectionId ||
            choice.children.some((child) => scopeKey(child.scope) === selected)));
      details.append(node(root, 'summary', choice.label));
      const children = node(root, 'div', null, 'scope-children');
      children.append(
        button(choice, choice.scope.kind === 'module' ? 'Use entire module' : 'Use entire section'),
      );
      for (const child of choice.children) children.append(branch(child));
      details.append(children);
      return details;
    };
    list.append(button(choices));
    for (const choice of choices.children) list.append(branch(choice));
  }
  function update(next, saving = false) {
    state = next;
    const thread = activeThread(state.chat),
      scope = thread?.scope || { kind: 'course' };
    const key = `${state.courseId}:${thread?.id}`;
    if (key !== identity) {
      close();
      identity = key;
      menuKey = '';
    }
    chip.disabled = !thread || !state.snapshot || saving;
    const choices = scopeChoices(state.snapshot);
    const choice = findScope(choices, scope);
    const current =
      scope.kind === 'current' ? resolveCurrentScope(state.snapshot, state.context) : null;
    const label = current?.available
      ? `This tab · ${current.currentSource.title}`
      : choice?.label || scope.label || 'Unavailable source';
    root.querySelector('#scope-label').textContent = label;
    chip.title = `Conversation scope: ${label}${choice ? '' : ' (no longer in course materials)'}`;
    chip.setAttribute('aria-label', `Conversation scope: ${label}`);
    root.querySelector('#scope-status').textContent =
      current && !current.available
        ? current.reason
        : !choice && state.snapshot
          ? 'This source is no longer in the course. Choose another scope.'
          : '';
    root.querySelector('#scope-status').hidden = current
      ? current.available
      : Boolean(choice) || !state.snapshot;
    const nextMenuKey = JSON.stringify([choices, scope]);
    if (nextMenuKey !== menuKey) {
      menuKey = nextMenuKey;
      renderOptions(choices, scope);
    }
    for (const button of list.querySelectorAll('button')) button.disabled = saving;
  }
  chip.addEventListener('click', () => {
    if (picker.hidden) {
      update(state);
      picker.hidden = false;
      chip.setAttribute('aria-expanded', 'true');
      list.querySelector('[aria-pressed="true"]')?.focus();
    } else close();
  });
  root.querySelector('#scope-close').addEventListener('click', () => close(true));
  const outside = (event) => {
    if (!picker.hidden && !picker.contains(event.target) && !chip.contains(event.target)) close();
  };
  const keyboard = (event) => {
    if (picker.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const visible = [...picker.querySelectorAll('button, summary')].filter((el) => {
        for (
          let parent = el.parentElement;
          parent && parent !== picker;
          parent = parent.parentElement
        )
          if (parent.tagName === 'DETAILS' && !parent.open && el !== parent.firstElementChild)
            return false;
        return !el.disabled;
      });
      const index = visible.indexOf(root.activeElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? visible.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      event.preventDefault();
      visible[next]?.focus();
    }
  };
  root.addEventListener('click', outside);
  root.addEventListener('focusin', outside);
  root.addEventListener('keydown', keyboard);
  return {
    update,
    close,
    dispose() {
      root.removeEventListener('click', outside);
      root.removeEventListener('focusin', outside);
      root.removeEventListener('keydown', keyboard);
    },
  };
}
