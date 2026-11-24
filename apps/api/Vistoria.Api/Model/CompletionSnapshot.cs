namespace Vistoria.Api.Model;

/// <summary>
/// O imóvel e o cliente como estavam na conclusão, copiados pelo servidor (ADR 0068): o laudo de uma concluída não
/// muda quando o imóvel ou o cliente mudam depois. Fica nas colunas da própria <c>inspections</c> (complex type).
/// </summary>
public class CompletionSnapshot
{
    public string Street { get; set; } = "";
    public string Number { get; set; } = "";
    public string? Complement { get; set; }
    public string District { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string ZipCode { get; set; } = "";
    public PropertyType PropertyType { get; set; }
    public string ClientName { get; set; } = "";
    public string? ClientDocument { get; set; }

    /// <summary>O cliente vem pelo FK do imóvel e não é excluído na V1; sem ele, a cópia sai com o nome vazio.</summary>
    public static CompletionSnapshot Of(Property property, Client? client) => new()
    {
        Street = property.Street,
        Number = property.Number,
        Complement = property.Complement,
        District = property.District,
        City = property.City,
        State = property.State,
        ZipCode = property.ZipCode,
        PropertyType = property.Type,
        ClientName = client?.Name ?? "",
        ClientDocument = client?.Document,
    };
}
