using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Model;

/// <summary>Locador ou locatário dono de imóveis (vision.md, "Client, Property e Template").</summary>
public class Client : SyncEntity
{
    public string Name { get; set; } = "";
    public string? Document { get; set; } // CPF ou CNPJ sem máscara, como o cliente enviou
    public string? Email { get; set; }
    public string? Phone { get; set; }
}
