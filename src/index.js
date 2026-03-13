const app = require('./service.js');
console.log("ROOT INDEX STARTED");
const metrics = require('./metrics');
console.log("ABOUT TO START METRICS");
metrics.startReporting();
const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log('test index.js')
});
