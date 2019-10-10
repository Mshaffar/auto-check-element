/* @flow strict */

import debounce from './debounce'

type Controller = AbortController | {signal: ?AbortSignal, abort: () => void}

type State = {
  check: Event => mixed,
  previousValue: ?string,
  controller: ?Controller
}

const states = new WeakMap<AutoCheckElement, State>()

export default class AutoCheckElement extends HTMLElement {
  connectedCallback() {
    const input = this.input
    if (!input) return

    const checker = debounce(check.bind(null, this), 300)
    const state = {check: checker, controller: null, previousValue: null}
    states.set(this, state)

    input.addEventListener('change', checker)
    input.addEventListener('input', checker)
    input.autocomplete = 'off'
    input.spellcheck = false
  }

  disconnectedCallback() {
    const input = this.input
    if (!input) return

    const state = states.get(this)
    if (!state) return
    states.delete(this)

    input.removeEventListener('change', state.check)
    input.removeEventListener('input', state.check)
    input.setCustomValidity('')
  }

  get input(): ?HTMLInputElement {
    const input = this.querySelector('input')
    return input instanceof HTMLInputElement ? input : null
  }

  get src(): string {
    const src = this.getAttribute('src')
    if (!src) return ''

    const link = this.ownerDocument.createElement('a')
    link.href = src
    return link.href
  }

  set src(value: string) {
    this.setAttribute('src', value)
  }

  get csrf(): string {
    return this.getAttribute('csrf') || ''
  }

  set csrf(value: string) {
    this.setAttribute('csrf', value)
  }

  get required(): boolean {
    return this.hasAttribute('required')
  }

  set required(required: boolean) {
    const input = this.input
    if (!input) return

    input.required = required
    if (required) {
      this.setAttribute('required', '')
    } else {
      this.removeAttribute('required')
    }
  }
}

function makeAbortController() {
  if ('AbortController' in window) {
    return new AbortController()
  }
  return {signal: null, abort() {}}
}

async function fetchWithNetworkEvents(el: Element, url: string, options: RequestOptions): Promise<Response> {
  try {
    const response = await fetch(url, options)
    el.dispatchEvent(new CustomEvent('load'))
    el.dispatchEvent(new CustomEvent('loadend'))
    return response
  } catch (error) {
    if (error.name !== 'AbortError') {
      el.dispatchEvent(new CustomEvent('error'))
      el.dispatchEvent(new CustomEvent('loadend'))
    }
    throw error
  }
}

async function check(autoCheckElement: AutoCheckElement) {
  const src = autoCheckElement.src
  if (!src) {
    throw new Error('missing src')
  }
  const csrf = autoCheckElement.csrf
  if (!csrf) {
    throw new Error('missing csrf')
  }
  const input = autoCheckElement.input
  if (!input) return

  const state = states.get(autoCheckElement)
  if (!state) return

  const body = new FormData()
  body.append('authenticity_token', csrf)
  body.append('value', input.value)

  const id = body.entries ? [...body.entries()].sort().toString() : null
  if (id && id === state.previousValue) return
  state.previousValue = id

  input.dispatchEvent(new CustomEvent('auto-check-send', {detail: {body}, bubbles: true}))

  if (!input.value.trim()) {
    input.dispatchEvent(new CustomEvent('auto-check-complete', {bubbles: true}))
    return
  }

  if (autoCheckElement.required) {
    input.setCustomValidity('Verifying…')
  }

  if (state.controller) {
    state.controller.abort()
  } else {
    autoCheckElement.dispatchEvent(new CustomEvent('loadstart'))
  }

  state.controller = makeAbortController()

  try {
    const response = await fetchWithNetworkEvents(autoCheckElement, src, {
      signal: state.controller.signal,
      method: 'POST',
      body
    })

    if (response.status === 200) {
      if (autoCheckElement.required) {
        input.setCustomValidity('')
      }
      input.dispatchEvent(new CustomEvent('auto-check-success', {detail: {response: response.clone()}, bubbles: true}))
    } else {
      if (autoCheckElement.required) {
        input.setCustomValidity('Input is not valid')
      }
      input.dispatchEvent(new CustomEvent('auto-check-error', {detail: {response: response.clone()}, bubbles: true}))
    }
  } catch (error) {
    // Network and abort errors handled already.
  } finally {
    state.controller = null
    input.dispatchEvent(new CustomEvent('auto-check-complete', {bubbles: true}))
  }
}

if (!window.customElements.get('auto-check')) {
  window.AutoCheckElement = AutoCheckElement
  window.customElements.define('auto-check', AutoCheckElement)
}
