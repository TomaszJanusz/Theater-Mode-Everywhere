interface AttributeRecord {
  element: Element;
  name: string;
  previous: string | null;
  applied: string | null;
}

interface StyleRecord {
  element: HTMLElement;
  name: string;
  previous: string;
  priority: string;
  applied: string;
}

interface ClassRecord {
  element: Element;
  name: string;
  previous: boolean;
  applied: boolean;
}

/**
 * Remembers individual class tokens, attributes, and CSS properties TME sets.
 * Restore writes those entries back only when the current value is still the one
 * we applied, so a later service edit to the same name — or any other inline style — stays.
 */
export class OwnedDom {
  private attributes: AttributeRecord[] = [];
  private styles: StyleRecord[] = [];
  private classes: ClassRecord[] = [];

  setClass(element: Element, name: string, enabled: boolean): void {
    let record = this.classes.find(entry => entry.element === element && entry.name === name);
    if (!record) {
      record = { element, name, previous: element.classList.contains(name), applied: enabled };
      this.classes.push(record);
    }
    record.applied = enabled;
    element.classList.toggle(name, enabled);
  }

  setAttribute(element: Element, name: string, value: string): void {
    const record = this.attribute(element, name);
    record.applied = value;
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  removeAttribute(element: Element, name: string): void {
    const record = this.attribute(element, name);
    record.applied = null;
    if (element.hasAttribute(name)) element.removeAttribute(name);
  }

  setProperty(element: HTMLElement, name: string, value: string): void {
    const record = this.style(element, name);
    record.applied = value;
    if (element.style.getPropertyValue(name) !== value || element.style.getPropertyPriority(name)) {
      element.style.setProperty(name, value);
    }
  }

  releaseAttribute(element: Element, name: string): void {
    const index = this.attributes.findIndex(record => record.element === element && record.name === name);
    if (index < 0) return;
    const [record] = this.attributes.splice(index, 1);
    if (element.getAttribute(name) !== record.applied) return;
    if (record.previous === null) element.removeAttribute(name);
    else element.setAttribute(name, record.previous);
  }

  restoreAll(): void {
    for (const record of this.classes.splice(0)) {
      if (record.element.classList.contains(record.name) === record.applied) {
        record.element.classList.toggle(record.name, record.previous);
      }
    }
    for (const record of this.styles.splice(0)) {
      if (record.element.style.getPropertyValue(record.name) !== record.applied || record.element.style.getPropertyPriority(record.name)) continue;
      if (record.previous) record.element.style.setProperty(record.name, record.previous, record.priority);
      else record.element.style.removeProperty(record.name);
    }
    for (const record of this.attributes.splice(0)) {
      const current = record.element.hasAttribute(record.name) ? record.element.getAttribute(record.name) : null;
      if (current !== record.applied) continue;
      if (record.previous === null) record.element.removeAttribute(record.name);
      else record.element.setAttribute(record.name, record.previous);
    }
  }

  private attribute(element: Element, name: string): AttributeRecord {
    const found = this.attributes.find((record) => record.element === element && record.name === name);
    if (found) return found;
    const record: AttributeRecord = {
      element,
      name,
      previous: element.hasAttribute(name) ? element.getAttribute(name) : null,
      applied: null
    };
    this.attributes.push(record);
    return record;
  }

  private style(element: HTMLElement, name: string): StyleRecord {
    const found = this.styles.find((record) => record.element === element && record.name === name);
    if (found) return found;
    const record: StyleRecord = {
      element,
      name,
      previous: element.style.getPropertyValue(name),
      priority: element.style.getPropertyPriority(name),
      applied: ''
    };
    this.styles.push(record);
    return record;
  }
}
