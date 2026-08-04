const readline = require('node:readline/promises');

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Opens one readline interface for a whole prompting session, so a command
// that asks several questions doesn't create (and leak) one per question.
async function withPrompt(fn) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });

  // A closed stream (Ctrl+D, or piped input running out) rejects the pending
  // question with an internal error; report it as a plain cancellation.
  const ask = async (question) => {
    try {
      return await rl.question(question);
    } catch (err) {
      if (closed) throw new Error('Cancelled — no input received.');
      throw err;
    }
  };

  try {
    return await fn({ ask });
  } finally {
    rl.close();
  }
}

// Numbered menu. `options` is [{ value, label }]. Re-asks on bad input.
async function chooseOption(ask, title, options, attempts = 3) {
  console.log(title);
  options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option.label}`);
  });
  console.log('');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const answer = (await ask(`Choose 1-${options.length} [1]: `)).trim();

    if (answer === '') {
      return options[0].value;
    }

    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1].value;
    }

    console.log(`"${answer}" is not one of the options.`);
  }

  throw new Error('No valid option chosen.');
}

module.exports = { isInteractive, withPrompt, chooseOption };
