const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 确定应用目录
const appDir = path.dirname(process.execPath);
console.log('App directory:', appDir);

// 后端服务路径
const backendPath = path.join(appDir, 'backend', 'backend-node16.exe');
console.log('Backend path:', backendPath);

// 前端应用路径
const frontendPath = path.join(appDir, 'frontend', 'portfolio-tool.exe');
console.log('Frontend path:', frontendPath);

// 检查文件是否存在
if (!fs.existsSync(backendPath)) {
  console.error('Backend executable not found:', backendPath);
  process.exit(1);
}

if (!fs.existsSync(frontendPath)) {
  console.error('Frontend executable not found:', frontendPath);
  process.exit(1);
}

// 启动后端服务
console.log('Starting backend service...');
const backendProcess = spawn(
  backendPath,
  [],
  { 
    detached: true, 
    stdio: 'ignore',
    cwd: path.dirname(backendPath)
  }
);
backendProcess.unref();

// 等待一段时间让后端启动
console.log('Waiting for backend to start...');
setTimeout(() => {
  // 启动前端应用
  console.log('Starting frontend application...');
  const frontendProcess = spawn(
    frontendPath,
    [],
    { 
      detached: false,
      stdio: 'inherit',
      cwd: path.dirname(frontendPath)
    }
  );

  frontendProcess.on('close', (code) => {
    console.log(`Frontend process exited with code ${code}`);
    process.exit(code);
  });
}, 2000);
