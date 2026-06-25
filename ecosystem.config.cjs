module.exports = {
  apps: [
    {
      name: "quotation-mvp",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/opt/quotation-mvp",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/opt/quotation-mvp/logs/error.log",
      out_file: "/opt/quotation-mvp/logs/out.log",
      merge_logs: true,
    },
  ],
};
