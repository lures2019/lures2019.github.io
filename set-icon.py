"""Embed a multiresolution ICO into an unsigned Windows application before packaging."""
import ctypes
import struct
import sys
from ctypes import wintypes
from pathlib import Path


def embed(exe, icon):
    data = icon.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data)
    if reserved or kind != 1 or not 1 <= count <= 256:
        raise ValueError("Invalid ICO file")
    images = []
    group = bytearray(data[:6])
    for i in range(count):
        pos = 6 + 16 * i
        size, offset = struct.unpack_from("<II", data, pos + 8)
        if size == 0 or offset < 6 + 16 * count or offset + size > len(data):
            raise ValueError("Truncated ICO image")
        images.append(data[offset:offset + size])
        group.extend(data[pos:pos + 12] + struct.pack("<H", i + 1))
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    api.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    api.BeginUpdateResourceW.restype = wintypes.HANDLE
    api.UpdateResourceW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                    wintypes.WORD, ctypes.c_void_p, wintypes.DWORD]
    api.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    handle = api.BeginUpdateResourceW(str(exe), False)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        for i, bitmap in enumerate(images, 1):
            if not api.UpdateResourceW(handle, 3, i, 1033, bitmap, len(bitmap)):
                raise ctypes.WinError(ctypes.get_last_error())
        if not api.UpdateResourceW(handle, 14, 1, 1033, bytes(group), len(group)):
            raise ctypes.WinError(ctypes.get_last_error())
    except BaseException:
        api.EndUpdateResourceW(handle, True)
        raise
    if not api.EndUpdateResourceW(handle, False):
        raise ctypes.WinError(ctypes.get_last_error())


if __name__ == "__main__":
    embed(Path(sys.argv[1]).resolve(strict=True), Path(sys.argv[2]).resolve(strict=True))
