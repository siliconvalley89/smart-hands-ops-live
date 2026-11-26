const MAX = { name: 80, company: 120, text: 1000 };
const MIN = { name: 2, text: 20 };

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

function validateReview(body = {}) {
  const name = trimmed(body.name);
  const company = trimmed(body.company);
  const text = trimmed(body.text);
  const rating = Number(body.rating);

  if (!name || name.length < MIN.name || name.length > MAX.name) return { error: `Enter your name (${MIN.name}-${MAX.name} characters).` };
  if (company.length > MAX.company) return { error: `Company must be ${MAX.company} characters or fewer.` };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Choose a rating from 1 to 5.' };
  if (text.length < MIN.text || text.length > MAX.text) return { error: `Review must be ${MIN.text}-${MAX.text} characters.` };
  return { review: { name, company, rating, text } };
}

function toPublicReview(id, data) {
  return {
    id,
    name: data.name || '',
    company: data.company || '',
    rating: data.rating,
    text: data.text || '',
    createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
  };
}

module.exports = { validateReview, toPublicReview };
