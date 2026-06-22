"""PyInstaller 打包入口。生产环境 Rust 外壳直接调用这个二进制。"""
from app.main import main

if __name__ == "__main__":
    main()
