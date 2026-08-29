/**
 * Обрезает текст до указанной длины и добавляет многоточие
 * @param {string} text - исходный текст
 * @param {number} maxLength - максимальная длина
 * @returns {string} - обрезанный текст
 */
export const truncateText = (text, maxLength = 50) => {
  if (!text || typeof text !== 'string') return '';
  
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.substring(0, maxLength) + '...';
};

/**
 * Обрезает название опроса для отображения в карточках
 * @param {string} title - название опроса
 * @returns {string} - обрезанное название
 */
export const truncateSurveyTitle = (title) => {
  return truncateText(title, 40);
};

/**
 * Обрезает имя участника для отображения в статистике
 * @param {string} name - имя участника
 * @returns {string} - обрезанное имя
 */
export const truncateParticipantName = (name) => {
  return truncateText(name, 25);
};

/**
 * Обрезает описание опроса для отображения в карточках
 * @param {string} description - описание опроса
 * @returns {string} - обрезанное описание
 */
export const truncateSurveyDescription = (description) => {
  return truncateText(description, 80);
}; 