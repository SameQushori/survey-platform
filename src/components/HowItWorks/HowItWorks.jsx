import React from 'react';
import './HowItWorks.css';

const HowItWorks = () => {
  const steps = [

    {
      number: 1,
      title: 'Создание опроса',
      description: 'Создайте опрос вопросами и вариантами ответов на любую тему'
    },
    {
      number: 2,
      title: 'Генерация QR-кода',
      description: 'Система автоматически создает уникальный код для каждого опроса'
    },
    {
      number: 3,
      title: 'Участие',
      description: 'Участники сканируют или вводят код, вводят имя и отвечают на вопросы'
    },
    {
      number: 4,
      title: 'Результаты',
      description: 'Получайте детальную статистику и аналитику по всем участникам'
    }
  ];

  return (
    <section className="how-it-works">
      <div className="how-content">
        <h2 className="section-title">Как это работает</h2>
        <p className="section-subtitle">Простой процесс в несколько шагов</p>
        
        <div className="steps">
          {steps.map((step, index) => (
            <div key={index} className="step">
              <div className="step-number">{step.number}</div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks; 