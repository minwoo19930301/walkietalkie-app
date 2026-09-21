import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'
import test from 'node:test'
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
const start = source.indexOf('function sanitizeCapacityValue(')
const end = source.indexOf('function shouldInitiateOffer(', start)
test('room metadata can be merged on receipt without interrupting participant updates', () => {
 const context = { DEFAULT_ROOM_CAPACITY: 4, state: { room: { id: '123456', title: 'Old', capacity: 4 } }, sanitizeRoomId: v => v }
 runInNewContext(source.slice(start, end) + ';mergeRoomMeta({roomId:"123456",roomTitle:"Room",capacity:4,isPrivate:false})', context)
 assert.equal(context.state.room.title, 'Room')
 assert.equal(context.state.room.capacity, 4)
 for(const value of [undefined,0,99,'bad']) {
  context.value = value
  assert.equal(runInNewContext('sanitizeCapacityValue(value)',context),4)
 }
 for(const value of [4,6,8]) {
  context.value = value
  assert.equal(runInNewContext('sanitizeCapacityValue(value)',context),value)
 }
})
