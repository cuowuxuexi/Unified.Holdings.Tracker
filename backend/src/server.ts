import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import marketDataRouter from './routes/marketData'; // �����г�����·��
import portfolioRouter from './routes/portfolio'; // ����Ͷ�����·��
import { dataService } from './services/dataService'; // �������ݷ��ʷ���
import { initExchangeRates } from './services/currencyService'; // ֻ�����ʼ������
import { appEnv } from './config/env';

// ��¼������Ϣ
const isProduction = appEnv.nodeEnv === 'production';
console.log(`Server starting in ${isProduction ? 'production' : 'development'} mode`);
console.log(`Data directory: ${dataService.getDataDirPath()}`);

const app: Express = express();
const port = appEnv.port; // ʹ�� 3001 �˿ڣ�������ǰ�˳��ö˿ڳ�ͻ
const apiBasePath = appEnv.apiBasePath;

// �м��
app.use(cors()); // ������������
app.use(express.json()); // ���� JSON ������
app.use(express.urlencoded({ extended: true })); // ���� URL ������������


// API ·��
app.use(`${apiBasePath}/market`, marketDataRouter); // ��ȷ�г�����·��·��
app.use(`${apiBasePath}/portfolio`, portfolioRouter); // ����Ͷ�����·��

// ����·�����ڲ���
app.get('/', (_req: Request, res: Response) => {
  res.send('Backend server is running!');
});

/**
 * ���첽��ʽ��ʼ�����ʲ�����������
 */
(async () => {
  try {
    console.log('���ڳ�ʼ������...');
    await initExchangeRates();
    console.log('���ʳ�ʼ���ɹ���');
    app.listen(port, () => {
      console.log(`[server]: Server is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('���ʳ�ʼ�������������ʧ��:', error);
    process.exit(1);
  }
})();

// ���Źرմ��� (��ѡ�����Ƽ�)
process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    // ������������������߼�������ر����ݿ�����
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    // ������������������߼�
    process.exit(0);
});
