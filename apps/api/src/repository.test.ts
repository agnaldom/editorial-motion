import assert from 'node:assert/strict';
import test from 'node:test';
import {LocalJobQueue, MemoryJobRepository} from './repository';

test('queue processes jobs sequentially in order and survives failures', async () => {
  const order: string[] = [];
  const queue = new LocalJobQueue(async (jobId) => {
    order.push(jobId);
    if (jobId === 'job_bad') throw new Error('boom');
  });
  queue.enqueue('job_1');
  queue.enqueue('job_bad');
  queue.enqueue('job_2');
  await queue.close();
  assert.deepEqual(order, ['job_1', 'job_bad', 'job_2']);
});

test('repository stores independent copies', async () => {
  const repository = new MemoryJobRepository();
  const job = {id: 'job_1', status: 'queued' as const, stage: 'queued' as const, progress: 0, attempt: 0, createdAt: 't', updatedAt: 't'};
  await repository.save(job);
  job.progress = 50;
  assert.equal((await repository.get('job_1'))?.progress, 0);
});
