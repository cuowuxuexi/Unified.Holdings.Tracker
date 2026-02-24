module.exports = {
    apps: [
        {
            name: 'uht-backend',
            script: 'apps/backend/dist/server-bundle.js',
            cwd: '/opt/uht',
            env: {
                NODE_ENV: 'production',
                PORT: 3001,
            },
            // 日志配置
            error_file: '/opt/uht/logs/pm2-error.log',
            out_file: '/opt/uht/logs/pm2-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            // 自动重启
            max_restarts: 10,
            restart_delay: 3000,
            // 内存超限自动重启
            max_memory_restart: '512M',
        },
    ],
};
