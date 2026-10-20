namespace Vistoria.Api.Tests.Support;

/// <summary>Raiz do repositório, para testes que conferem arquivos commitados (docs, openapi.json).</summary>
public static class RepoRoot
{
    public static string Path { get; } = Find();

    private static string Find()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(System.IO.Path.Combine(dir.FullName, "docs", "architecture")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new DirectoryNotFoundException("Raiz do repositório não encontrada.");
    }
}
