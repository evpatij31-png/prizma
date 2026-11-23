import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isTyping, resolveHotkey, type KeyLike } from '../src/lib/hotkeys.ts'

const press = (over: Partial<KeyLike>): KeyLike => ({ code: '', key: '', ...over })

test('letter shortcuts map to their views', () => {
  assert.equal(resolveHotkey(press({ code: 'KeyM', key: 'm' })), 'view-month')
  assert.equal(resolveHotkey(press({ code: 'KeyW', key: 'w' })), 'view-week')
  assert.equal(resolveHotkey(press({ code: 'KeyD', key: 'd' })), 'view-day')
  assert.equal(resolveHotkey(press({ code: 'KeyA', key: 'a' })), 'view-agenda')
  assert.equal(resolveHotkey(press({ code: 'KeyT', key: 't' })), 'today')
  assert.equal(resolveHotkey(press({ code: 'KeyN', key: 'n' })), 'new-event')
})

test('shortcuts keep working on a Russian layout', () => {
  // The whole reason this matches `code`: on ЙЦУКЕН the same physical keys
  // report these characters, and a `key`-based binding would be dead for
  // exactly the users this interface is written for.
  assert.equal(resolveHotkey(press({ code: 'KeyM', key: 'ь' })), 'view-month')
  assert.equal(resolveHotkey(press({ code: 'KeyW', key: 'ц' })), 'view-week')
  assert.equal(resolveHotkey(press({ code: 'KeyD', key: 'в' })), 'view-day')
  assert.equal(resolveHotkey(press({ code: 'KeyA', key: 'ф' })), 'view-agenda')
  assert.equal(resolveHotkey(press({ code: 'KeyT', key: 'е' })), 'today')
})

test('arrows step the interval', () => {
  assert.equal(resolveHotkey(press({ code: 'ArrowLeft', key: 'ArrowLeft' })), 'prev')
  assert.equal(resolveHotkey(press({ code: 'ArrowRight', key: 'ArrowRight' })), 'next')
})

test('slash opens search by the character, not the position', () => {
  // `/` lives on different physical keys across layouts.
  assert.equal(resolveHotkey(press({ code: 'Slash', key: '/' })), 'search')
  assert.equal(resolveHotkey(press({ code: 'KeyQ', key: '/' })), 'search')
})

test('delete removes the selection, from either key', () => {
  assert.equal(resolveHotkey(press({ code: 'Delete', key: 'Delete' })), 'delete')
  assert.equal(resolveHotkey(press({ code: 'Backspace', key: 'Backspace' })), 'delete')
})

test('modifier combinations are left to the browser', () => {
  assert.equal(resolveHotkey(press({ code: 'KeyM', key: 'm', ctrlKey: true })), null)
  assert.equal(resolveHotkey(press({ code: 'KeyN', key: 'n', metaKey: true })), null)
  assert.equal(resolveHotkey(press({ code: 'ArrowLeft', key: 'ArrowLeft', altKey: true })), null)
})

test('typing in a field is not a shortcut', () => {
  const target = { tagName: 'INPUT' }
  assert.equal(resolveHotkey(press({ code: 'KeyM', key: 'm', target })), null)
  assert.equal(resolveHotkey(press({ code: 'Slash', key: '/', target })), null)
  assert.equal(resolveHotkey(press({ code: 'Delete', key: 'Delete', target })), null)
})

test('Escape works even while typing, because that is how you get out', () => {
  assert.equal(resolveHotkey(press({ code: 'Escape', key: 'Escape', target: { tagName: 'INPUT' } })), 'close')
  assert.equal(resolveHotkey(press({ code: 'Escape', key: 'Escape' })), 'close')
})

test('isTyping covers every editable surface', () => {
  assert.equal(isTyping({ tagName: 'INPUT' }), true)
  assert.equal(isTyping({ tagName: 'textarea' }), true)
  assert.equal(isTyping({ tagName: 'SELECT' }), true)
  assert.equal(isTyping({ isContentEditable: true }), true)
  assert.equal(isTyping({ tagName: 'DIV' }), false)
  assert.equal(isTyping(null), false)
  assert.equal(isTyping(undefined), false)
})

test('an unbound key does nothing', () => {
  assert.equal(resolveHotkey(press({ code: 'KeyZ', key: 'z' })), null)
  assert.equal(resolveHotkey(press({ code: 'F5', key: 'F5' })), null)
})
