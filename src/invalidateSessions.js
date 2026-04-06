const { DB } = require('./database/database.js');

async function main() {
  await DB.invalidateAllSessions();
  console.log('Invalidated all auth sessions');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to invalidate auth sessions', error);
    process.exit(1);
  });
