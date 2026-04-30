/**
 * RESET TEST DATA
 * Cleans up all test-related Redis keys
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BACKEND_URL = 'http://localhost:5000';

// All test addresses (real testnet accounts)
const TEST_ADDRESSES = [
  'GACEXZXJV22DBLDNSEXW44OOGYDQVYJH6QFSFZONCBONNCK43H6P6TJC', // test1
  'GCJCDMSB4M4ALXUFCF4IOH4QOKV753EIYDNZHIXD5LGQIVRGX5WDE4B3', // test2
  'GCUQD5FOYAAMZNESAA23TKZZPE5AZ5I6UV2NHNSFPGOYZVES25CIXUD4', // test3
  'GCO5X4EGVLTRWHACJTAK7MGBLU5ESPPPL2TIKTCW3K46CHMR6D2TRHU5', // test4
  'GB5H543PS7TOOQPHIOWRHRIJYUKRHOS46AIUORJCCYURTGJDRGVD5LNH', // test5
  'GCMEKTHZ5KUJ4A5NVOH26PXRW72QQS5FHVSQCXIGPSNWIBGKYBHRO2SW', // test6
  'GCHP3QYRDEJ7GORWGZ54TTUCYS3CTH7QJ6MU5GVSJHII366ICXMTORWK', // test7
  'GDMZRVCD6TEOQJFZGM7NHYNT37Q2OQE4QGSBGDSDZOSBOAZB22WR3TZ7', // test8
  'GA44BFZJVZH6Q2ECUY5QWB5YA6LHJ4IZFNWR7MPPQ54JN7SOWAL7E3XW', // test9
];

async function resetTestData() {
  console.log('Resetting test data...\n');
  
  const { Redis } = require('@upstash/redis');
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  
  let deletedCount = 0;
  
  // Delete user stats
  for (const addr of TEST_ADDRESSES) {
    await redis.del(`orchid:user_stats:${addr}`).catch(() => {});
    await redis.del(`orchid:bond:${addr}`).catch(() => {});
    await redis.del(`orchid:rate_limit:${addr}`).catch(() => {});
    deletedCount += 3;
  }
  
  // Delete intent tracking keys
  const trackingKeys = await redis.keys('orchid:intent_track:*').catch(() => []);
  for (const key of trackingKeys) {
    await redis.del(key).catch(() => {});
    deletedCount++;
  }
  
  // Delete escrow resolved keys
  const resolvedKeys = await redis.keys('orchid:escrow_resolved:*').catch(() => []);
  for (const key of resolvedKeys) {
    await redis.del(key).catch(() => {});
    deletedCount++;
  }
  
  // Delete intent keys for test escrows (10001-10030, 99999)
  for (let i = 10001; i <= 10030; i++) {
    await redis.del(`orchid:intent:${i}`).catch(() => {});
    await redis.del(`orchid:intent_callers:${i}`).catch(() => {});
    deletedCount += 2;
  }
  await redis.del('orchid:intent:99999').catch(() => {});
  await redis.del('orchid:intent_callers:99999').catch(() => {});
  deletedCount += 2;
  
  console.log(`✅ Deleted ${deletedCount} Redis keys`);
  console.log('✅ Test data reset complete\n');
}

resetTestData().catch(console.error);
